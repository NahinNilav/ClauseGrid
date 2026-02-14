from __future__ import annotations

import json
import logging
import math
import os
import random
import re
import time
from typing import Any, Dict, List, Tuple

try:
    from google import genai
except Exception:  # pragma: no cover - optional dependency in local envs
    genai = None


logger = logging.getLogger("tabular.server")


LEGAL_SYNONYMS: Dict[str, List[str]] = {
    "termination": ["expire", "end", "cancel", "termination for cause", "termination for convenience"],
    "governing": ["governing law", "jurisdiction", "venue", "applicable law"],
    "indemnity": ["indemnification", "hold harmless", "defend", "indemnify"],
    "liability": ["limitation of liability", "cap", "damages", "liability cap"],
    "notice": ["notification", "written notice", "notice period", "delivery notice"],
    "effective": ["effective date", "commencement date", "start date"],
    "parties": ["party", "entity", "entities", "company", "counterparty"],
    "obligation": ["shall", "must", "responsibility", "duty", "required to"],
    "payment": ["fees", "amount due", "invoice", "payment terms"],
}


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _tokenize(value: str) -> List[str]:
    return [tok for tok in re.findall(r"[a-zA-Z0-9]+", (value or "").lower()) if len(tok) >= 2]


def _token_set(value: str) -> set[str]:
    return set(_tokenize(value))


def _cosine(left: List[float], right: List[float]) -> float:
    if not left or not right:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    l2_left = math.sqrt(sum(a * a for a in left))
    l2_right = math.sqrt(sum(b * b for b in right))
    if l2_left <= 0 or l2_right <= 0:
        return 0.0
    return dot / (l2_left * l2_right)


def _hash_embedding(text: str, dim: int = 256) -> List[float]:
    vec = [0.0] * dim
    for token in _tokenize(text):
        idx = hash(token) % dim
        vec[idx] += 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def _expand_legal_query(field: Dict[str, Any]) -> str:
    base = f"{field.get('name', '')} {field.get('prompt', '')} {field.get('type', '')}"
    tokens = _token_set(base)
    expansions: List[str] = []
    for trigger, synonyms in LEGAL_SYNONYMS.items():
        if trigger in tokens:
            expansions.extend(synonyms)
    return _normalize_space(" ".join([base] + expansions))


def retrieve_legal_candidates(
    *,
    artifact: Dict[str, Any],
    field: Dict[str, Any],
    doc_version_id: str,
    top_k: int = 6,
) -> List[Dict[str, Any]]:
    query = _expand_legal_query(field)
    query_tokens = _token_set(query)
    query_embedding = _hash_embedding(query)

    blocks = artifact.get("blocks") or []
    candidates: List[Dict[str, Any]] = []

    for block in blocks:
        if not isinstance(block, dict):
            continue
        text = _normalize_space(str(block.get("text") or ""))
        if not text:
            continue

        text_tokens = _token_set(text)
        overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens))
        semantic = _cosine(query_embedding, _hash_embedding(text))
        structure_prior = 0.1 if block.get("type") == "table" else 0.0
        final_score = 0.5 * semantic + 0.3 * overlap + 0.2 * structure_prior

        citations: List[Dict[str, Any]] = []
        for citation in block.get("citations") or []:
            if not isinstance(citation, dict):
                continue
            payload = dict(citation)
            payload["doc_version_id"] = doc_version_id
            citations.append(payload)

        candidates.append(
            {
                "block_id": block.get("id"),
                "block_type": block.get("type") or "paragraph",
                "text": text[:8000],
                "citations": citations,
                "scores": {
                    "semantic": round(semantic, 4),
                    "lexical": round(overlap, 4),
                    "structure": round(structure_prior, 4),
                    "final": round(final_score, 4),
                },
            }
        )

    candidates.sort(key=lambda c: c["scores"]["final"], reverse=True)
    return candidates[: max(1, top_k)]


class GeminiLegalClient:
    def __init__(self) -> None:
        self.api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.extraction_model = os.getenv("LEGAL_EXTRACTION_MODEL", "gemini-3-pro-preview")
        self.extraction_fast_model = os.getenv("LEGAL_EXTRACTION_FAST_MODEL", "gemini-3-flash-preview")
        self.verifier_model = os.getenv("LEGAL_VERIFIER_MODEL", self.extraction_model)
        try:
            self.rate_limit_retries = max(0, int(os.getenv("GEMINI_RATE_LIMIT_RETRIES", "2")))
        except ValueError:
            self.rate_limit_retries = 2
        try:
            self.rate_limit_base_delay_seconds = max(0.1, float(os.getenv("GEMINI_RATE_LIMIT_BASE_DELAY_SECONDS", "1.0")))
        except ValueError:
            self.rate_limit_base_delay_seconds = 1.0
        self.client = None
        if genai is not None:
            try:
                if self.api_key:
                    self.client = genai.Client(api_key=self.api_key)
                else:
                    self.client = genai.Client()
            except Exception:
                self.client = None

    @property
    def enabled(self) -> bool:
        return self.client is not None

    @staticmethod
    def _model_for_quality(quality_profile: str, default_model: str, fast_model: str) -> str:
        profile = (quality_profile or "high").lower()
        if profile == "fast":
            return fast_model or default_model
        return default_model

    @staticmethod
    def _thinking_level(quality_profile: str, model: str) -> str:
        """Map quality profile to Gemini thinking_level.

        Per official Gemini 3 docs:
          - Pro supports:  low, high (default)
          - Flash supports: minimal, low, medium, high (default)
        """
        profile = (quality_profile or "high").lower()
        is_flash = "flash" in (model or "").lower()
        if profile == "fast":
            return "minimal" if is_flash else "low"
        if profile == "balanced":
            return "medium" if is_flash else "low"
        return "high"

    @staticmethod
    def _is_rate_limit_error(exc: Exception) -> bool:
        status = getattr(exc, "status_code", None)
        if status is None:
            status = getattr(exc, "status", None)
        if status is None:
            status = getattr(exc, "code", None)
        if status == 429:
            return True

        message = _normalize_space(str(exc)).lower()
        return any(
            token in message
            for token in (
                "429",
                "resource_exhausted",
                "quota",
                "rate limit",
                "too many requests",
            )
        )

    @staticmethod
    def _log_structured(level: int, event: str, **fields: Any) -> None:
        payload = {"event": event, **fields}
        logger.log(level, json.dumps(payload, default=str))

    def _generate(
        self,
        *,
        operation: str,
        model: str,
        prompt: str,
        quality_profile: str,
        response_schema: Dict[str, Any] | None = None,
    ) -> str:
        if not self.enabled:
            raise RuntimeError("Gemini client is unavailable. Install google-genai and set GEMINI_API_KEY.")

        thinking_level = self._thinking_level(quality_profile, model)

        config: Dict[str, Any] = {
            "thinking_config": {"thinking_level": thinking_level},
            "response_mime_type": "application/json",
        }
        if response_schema:
            config["response_json_schema"] = response_schema

        attempt = 0
        while True:
            attempt += 1
            try:
                response = self.client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=config,
                )
                break
            except Exception as exc:
                is_rate_limited = self._is_rate_limit_error(exc)
                if is_rate_limited:
                    can_retry = attempt <= self.rate_limit_retries
                    self._log_structured(
                        logging.WARNING if can_retry else logging.ERROR,
                        "gemini_rate_limited",
                        operation=operation,
                        model=model,
                        quality_profile=quality_profile,
                        thinking_level=thinking_level,
                        attempt=attempt,
                        max_retries=self.rate_limit_retries,
                        will_retry=can_retry,
                        error_type=type(exc).__name__,
                        error=str(exc),
                    )
                    if can_retry:
                        delay_seconds = self.rate_limit_base_delay_seconds * (2 ** (attempt - 1)) + random.random()
                        time.sleep(delay_seconds)
                        continue

                self._log_structured(
                    logging.ERROR,
                    "gemini_request_failed",
                    operation=operation,
                    model=model,
                    quality_profile=quality_profile,
                    thinking_level=thinking_level,
                    attempt=attempt,
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
                raise RuntimeError(f"Gemini request failed: {exc}") from exc

        text = str(getattr(response, "text", "") or "").strip()
        if not text:
            candidates = getattr(response, "candidates", None) or []
            recovered: List[str] = []
            for candidate in candidates:
                content = getattr(candidate, "content", None)
                parts = getattr(content, "parts", None) or []
                for part in parts:
                    part_text = str(getattr(part, "text", "") or "").strip()
                    if part_text:
                        recovered.append(part_text)
            text = "\n".join(recovered).strip()
        if not text:
            raise RuntimeError("Gemini returned empty content")
        return text

    @staticmethod
    def _extract_json_object(text: str) -> Dict[str, Any]:
        raw = (text or "").strip()
        if not raw:
            return {}

        try:
            value = json.loads(raw)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass

        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                value = json.loads(raw[start : end + 1])
                if isinstance(value, dict):
                    return value
            except json.JSONDecodeError:
                return {}
        return {}

    def extract(
        self,
        *,
        field: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        quality_profile: str,
    ) -> Dict[str, Any]:
        model = self._model_for_quality(
            quality_profile,
            default_model=self.extraction_model,
            fast_model=self.extraction_fast_model,
        )
        evidence = []
        for idx, candidate in enumerate(candidates):
            citation = (candidate.get("citations") or [{}])[0]
            evidence.append(
                {
                    "candidate_index": idx,
                    "text": candidate.get("text") or "",
                    "page": citation.get("page"),
                    "selector": citation.get("selector"),
                    "score": candidate.get("scores", {}).get("final"),
                }
            )

        prompt = (
            "You are extracting legal fields from evidence snippets. "
            "Return ONLY JSON with keys: value, raw_text, evidence_summary, candidate_index, confidence.\n"
            "Rules: cite only from provided snippets, do not fabricate, keep value concise and field-typed.\n"
            f"Field: {json.dumps(field)}\n"
            f"Quality profile: {quality_profile}\n"
            f"Evidence candidates: {json.dumps(evidence)}"
        )
        response_schema = {
            "type": "object",
            "properties": {
                "value": {"type": "string"},
                "raw_text": {"type": "string"},
                "evidence_summary": {"type": "string"},
                "candidate_index": {"type": "integer"},
                "confidence": {"type": "number"},
            },
        }
        text = self._generate(
            operation="extract",
            model=model,
            prompt=prompt,
            quality_profile=quality_profile,
            response_schema=response_schema,
        )
        payload = self._extract_json_object(text)
        value = str(payload.get("value") or "").strip()
        raw_text = str(payload.get("raw_text") or "").strip()
        evidence_summary = str(payload.get("evidence_summary") or "").strip()
        candidate_index = payload.get("candidate_index")
        try:
            candidate_index = int(candidate_index)
        except (TypeError, ValueError):
            candidate_index = 0
        confidence = payload.get("confidence")
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0.65
        return {
            "value": value,
            "raw_text": raw_text or value,
            "evidence_summary": evidence_summary or "LLM extracted value from retrieved legal evidence.",
            "candidate_index": max(0, min(candidate_index, max(0, len(candidates) - 1))),
            "confidence": max(0.0, min(1.0, confidence)),
            "model_name": model,
        }

    def verify(
        self,
        *,
        field: Dict[str, Any],
        value: str,
        raw_text: str,
        candidates: List[Dict[str, Any]],
        quality_profile: str = "high",
    ) -> Dict[str, Any]:
        evidence = []
        for idx, candidate in enumerate(candidates):
            evidence.append(
                {
                    "candidate_index": idx,
                    "text": candidate.get("text") or "",
                }
            )
        prompt = (
            "You are verifying a legal extraction against evidence snippets. "
            "Return ONLY JSON with keys: verifier_status, reason, best_candidate_index.\n"
            "verifier_status must be PASS, PARTIAL, or FAIL.\n"
            f"Field: {json.dumps(field)}\n"
            f"Claimed value: {value}\n"
            f"Claimed raw_text: {raw_text}\n"
            f"Evidence: {json.dumps(evidence)}"
        )
        response_schema = {
            "type": "object",
            "properties": {
                "verifier_status": {"type": "string"},
                "reason": {"type": "string"},
                "best_candidate_index": {"type": "integer"},
            },
        }
        text = self._generate(
            operation="verify",
            model=self.verifier_model,
            prompt=prompt,
            quality_profile=quality_profile,
            response_schema=response_schema,
        )
        payload = self._extract_json_object(text)
        status = str(payload.get("verifier_status") or "PARTIAL").upper()
        if status not in {"PASS", "PARTIAL", "FAIL"}:
            status = "PARTIAL"
        reason = str(payload.get("reason") or "").strip() or "Verifier returned no specific reason."
        best_candidate_index = payload.get("best_candidate_index")
        try:
            best_candidate_index = int(best_candidate_index)
        except (TypeError, ValueError):
            best_candidate_index = 0
        return {
            "verifier_status": status,
            "reason": reason,
            "best_candidate_index": max(0, min(best_candidate_index, max(0, len(candidates) - 1))),
            "model_name": self.verifier_model,
        }


def confidence_from_signals(
    *,
    base_confidence: float,
    retrieval_score: float,
    verifier_status: str,
    self_consistent: bool,
) -> float:
    score = 0.45 * base_confidence + 0.35 * retrieval_score
    if verifier_status == "PASS":
        score += 0.15
    elif verifier_status == "PARTIAL":
        score += 0.03
    else:
        score -= 0.20
    if self_consistent:
        score += 0.08
    return max(0.05, min(0.98, round(score, 3)))


def self_consistency_agreement(left: str, right: str) -> bool:
    return _normalize_space(left).lower() == _normalize_space(right).lower()
