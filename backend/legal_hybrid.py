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

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional dependency in local envs
    OpenAI = None


logger = logging.getLogger("tabular.server")


def _log_structured(level: int, event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    logger.log(level, json.dumps(payload, default=str))


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
    blocks: List[Dict[str, Any]],
    field: Dict[str, Any],
    doc_version_id: str,
    block_embeddings: List[List[float] | None] | None = None,
    query_embedding: List[float] | None = None,
    top_k: int = 6,
) -> List[Dict[str, Any]]:
    query = _expand_legal_query(field)
    query_tokens = _token_set(query)
    hash_query_embedding: List[float] | None = None
    candidates: List[Dict[str, Any]] = []

    for idx, block in enumerate(blocks or []):
        if not isinstance(block, dict):
            continue
        text = _normalize_space(str(block.get("text") or ""))
        if not text:
            continue

        text_tokens = _token_set(text)
        overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens))

        block_embedding = None
        if block_embeddings and idx < len(block_embeddings):
            block_embedding = block_embeddings[idx]

        if query_embedding and block_embedding:
            semantic = _cosine(query_embedding, block_embedding)
        else:
            if hash_query_embedding is None:
                hash_query_embedding = _hash_embedding(query)
            semantic = _cosine(hash_query_embedding, _hash_embedding(text))

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
                "block_id": str(block.get("block_id") or block.get("id") or f"idx_{idx}"),
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
        _log_structured(level, event, **fields)

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


class OpenAILegalClient:
    _REASONING_EFFORT_VALUES = {"none", "minimal", "low", "medium", "high", "xhigh"}

    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.extraction_model_fast = os.getenv("OPENAI_EXTRACTION_MODEL_FAST", "gpt-5-mini")
        self.extraction_model_pro = os.getenv("OPENAI_EXTRACTION_MODEL_PRO", "gpt-5.2")
        self.verifier_model = os.getenv("OPENAI_VERIFIER_MODEL", "gpt-5-nano")
        self.extraction_model = self.extraction_model_fast
        self.reasoning_effort_fast = self._normalize_reasoning_effort(
            os.getenv("OPENAI_REASONING_EFFORT_FAST", "medium"),
            default="medium",
        )
        self.reasoning_effort_pro = self._normalize_reasoning_effort(
            os.getenv("OPENAI_REASONING_EFFORT_PRO", "medium"),
            default="medium",
        )
        self.reasoning_effort_verifier = self._normalize_reasoning_effort(
            os.getenv("OPENAI_REASONING_EFFORT_VERIFIER", "low"),
            default="low",
        )
        self.client = None
        if OpenAI is not None and self.api_key:
            try:
                self.client = OpenAI(api_key=self.api_key)
            except Exception:
                self.client = None
        _log_structured(
            logging.INFO,
            "openai_llm_client_initialized",
            enabled=self.enabled,
            extraction_model_fast=self.extraction_model_fast,
            extraction_model_pro=self.extraction_model_pro,
            verifier_model=self.verifier_model,
            reasoning_effort_fast=self.reasoning_effort_fast,
            reasoning_effort_pro=self.reasoning_effort_pro,
            reasoning_effort_verifier=self.reasoning_effort_verifier,
        )

    @property
    def enabled(self) -> bool:
        return bool(self.client is not None and self.api_key)

    @classmethod
    def _normalize_reasoning_effort(cls, value: str, *, default: str) -> str:
        effort = _normalize_space(value).lower()
        if effort in cls._REASONING_EFFORT_VALUES:
            return effort
        return default

    def _model_for_quality(self, quality_profile: str) -> Tuple[str, str]:
        profile = (quality_profile or "fast").lower()
        if profile == "high":
            return self.extraction_model_pro, self.reasoning_effort_pro
        return self.extraction_model_fast, self.reasoning_effort_fast

    @staticmethod
    def _extract_response_text(response: Any) -> str:
        text = str(getattr(response, "output_text", "") or "").strip()
        if text:
            return text

        output = getattr(response, "output", None)
        if output is None and isinstance(response, dict):
            output = response.get("output")

        recovered: List[str] = []
        for item in output or []:
            item_type = item.get("type") if isinstance(item, dict) else getattr(item, "type", None)
            if item_type != "message":
                continue
            content = item.get("content") if isinstance(item, dict) else getattr(item, "content", None)
            for part in content or []:
                part_type = part.get("type") if isinstance(part, dict) else getattr(part, "type", None)
                if part_type != "output_text":
                    continue
                part_text = part.get("text") if isinstance(part, dict) else getattr(part, "text", None)
                if part_text:
                    recovered.append(str(part_text))
        return "\n".join(recovered).strip()

    def _generate(
        self,
        *,
        operation: str,
        model: str,
        prompt: str,
        reasoning_effort: str,
    ) -> str:
        if not self.enabled:
            raise RuntimeError("OpenAI client is unavailable. Install openai and set OPENAI_API_KEY.")
        started_at = time.time()
        _log_structured(
            logging.INFO,
            "openai_llm_request_started",
            operation=operation,
            model=model,
            reasoning_effort=reasoning_effort,
            prompt_chars=len(prompt or ""),
        )
        try:
            response = self.client.responses.create(
                model=model,
                input=prompt,
                reasoning={"effort": reasoning_effort},
            )
        except Exception as exc:
            _log_structured(
                logging.ERROR,
                "openai_llm_request_failed",
                operation=operation,
                model=model,
                reasoning_effort=reasoning_effort,
                error_type=type(exc).__name__,
                error=str(exc),
            )
            raise RuntimeError(f"OpenAI request failed for {operation}: {exc}") from exc

        text = self._extract_response_text(response)
        if not text:
            raise RuntimeError("OpenAI returned empty content")

        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", None) if usage is not None else None
        output_tokens = getattr(usage, "output_tokens", None) if usage is not None else None
        reasoning_tokens = None
        if usage is not None:
            output_details = getattr(usage, "output_tokens_details", None)
            if output_details is not None:
                reasoning_tokens = getattr(output_details, "reasoning_tokens", None)

        _log_structured(
            logging.INFO,
            "openai_llm_request_completed",
            operation=operation,
            model=model,
            reasoning_effort=reasoning_effort,
            latency_ms=round((time.time() - started_at) * 1000, 2),
            output_chars=len(text),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            reasoning_tokens=reasoning_tokens,
        )
        return text

    def extract(
        self,
        *,
        field: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        quality_profile: str,
    ) -> Dict[str, Any]:
        model, reasoning_effort = self._model_for_quality(quality_profile)
        _log_structured(
            logging.INFO,
            "openai_extract_started",
            field_key=str(field.get("key") or field.get("id") or field.get("name") or ""),
            quality_profile=quality_profile,
            model=model,
            reasoning_effort=reasoning_effort,
            candidate_count=len(candidates),
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
        text = self._generate(
            operation="extract",
            model=model,
            prompt=prompt,
            reasoning_effort=reasoning_effort,
        )
        payload = GeminiLegalClient._extract_json_object(text)
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
        quality_profile: str = "fast",
    ) -> Dict[str, Any]:
        _log_structured(
            logging.INFO,
            "openai_verify_started",
            field_key=str(field.get("key") or field.get("id") or field.get("name") or ""),
            quality_profile=quality_profile,
            model=self.verifier_model,
            reasoning_effort=self.reasoning_effort_verifier,
            candidate_count=len(candidates),
        )
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
        text = self._generate(
            operation="verify",
            model=self.verifier_model,
            prompt=prompt,
            reasoning_effort=self.reasoning_effort_verifier,
        )
        payload = GeminiLegalClient._extract_json_object(text)
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


class OpenAIEmbeddingClient:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        try:
            self.batch_size = max(1, int(os.getenv("OPENAI_EMBEDDING_BATCH_SIZE", "64")))
        except ValueError:
            self.batch_size = 64
        self.client = None
        if OpenAI is not None and self.api_key:
            try:
                self.client = OpenAI(api_key=self.api_key)
            except Exception:
                self.client = None
        _log_structured(
            logging.INFO,
            "openai_embedding_client_initialized",
            enabled=self.enabled,
            model=self.model,
            batch_size=self.batch_size,
        )

    @property
    def enabled(self) -> bool:
        return bool(self.client is not None and self.api_key)

    @staticmethod
    def _clean_text(value: str) -> str:
        text = _normalize_space(value)
        return text if text else " "

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if not self.enabled:
            raise RuntimeError("OpenAI embeddings are unavailable. Install openai and set OPENAI_API_KEY.")

        started_at = time.time()
        _log_structured(
            logging.INFO,
            "openai_embedding_started",
            model=self.model,
            text_count=len(texts),
            batch_size=self.batch_size,
        )
        embeddings: List[List[float]] = []
        for start in range(0, len(texts), self.batch_size):
            chunk = [self._clean_text(text) for text in texts[start : start + self.batch_size]]
            chunk_started_at = time.time()
            try:
                response = self.client.embeddings.create(
                    model=self.model,
                    input=chunk,
                )
            except Exception as exc:
                _log_structured(
                    logging.ERROR,
                    "openai_embedding_failed",
                    model=self.model,
                    chunk_start_index=start,
                    chunk_size=len(chunk),
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
                raise RuntimeError(f"OpenAI embedding request failed: {exc}") from exc

            chunk_vectors: List[List[float] | None] = [None] * len(chunk)
            for item in response.data or []:
                index = item.get("index") if isinstance(item, dict) else getattr(item, "index", None)
                vector = item.get("embedding") if isinstance(item, dict) else getattr(item, "embedding", None)
                try:
                    target_index = int(index)
                except (TypeError, ValueError):
                    continue
                if target_index < 0 or target_index >= len(chunk):
                    continue
                chunk_vectors[target_index] = [float(v) for v in (vector or [])]

            for vector in chunk_vectors:
                embeddings.append(vector or [])
            _log_structured(
                logging.INFO,
                "openai_embedding_chunk_completed",
                model=self.model,
                chunk_start_index=start,
                chunk_size=len(chunk),
                latency_ms=round((time.time() - chunk_started_at) * 1000, 2),
            )

        _log_structured(
            logging.INFO,
            "openai_embedding_completed",
            model=self.model,
            text_count=len(texts),
            vector_count=len(embeddings),
            latency_ms=round((time.time() - started_at) * 1000, 2),
        )
        return embeddings


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
