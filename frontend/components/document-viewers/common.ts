import { ArtifactBlock, DocumentFile, ExtractionCell, SourceCitation } from '../../types';

export const decodeBase64Utf8 = (base64: string): string => {
  try {
    const cleanContent = base64.replace(/^data:.*;base64,/, '');
    const binaryString = atob(cleanContent);
    try {
      return decodeURIComponent(escape(binaryString));
    } catch {
      return binaryString;
    }
  } catch {
    return '';
  }
};

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .trim();

const expandIsoDateProbes = (value: string): string[] => {
  const normalized = (value || '').trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, monthRaw, dayRaw] = match;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const monthNames = [
    '',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthShort = [
    '',
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  if (month < 1 || month >= monthNames.length) return [];
  return [
    `${monthNames[month]} ${day}, ${year}`,
    `${monthShort[month]} ${day}, ${year}`,
    `${day} ${monthNames[month]} ${year}`,
    `${day} ${monthShort[month]} ${year}`,
  ];
};

const overlapScore = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeForMatch(left).split(' ').filter((token) => token.length > 2));
  const rightTokens = new Set(normalizeForMatch(right).split(' ').filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });

  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const headerBiasedFieldKeys = new Set(['document_title', 'parties_entities', 'effective_date_term']);

const earlyPageBoost = (fieldKey: string | undefined, page: number | undefined): number => {
  const normalizedField = normalizeForMatch(fieldKey || '');
  if (!normalizedField || !headerBiasedFieldKeys.has(normalizedField)) return 0;
  if (typeof page !== 'number' || !Number.isFinite(page)) return 0;
  if (page <= 3) return 0.35;
  if (page <= 10) return 0.2;
  return 0;
};

const isBoilerplateSnippet = (snippet: string): boolean => {
  const normalized = normalizeForMatch(snippet);
  return (
    normalized.includes('confidential treatment requested by tesla') ||
    normalized.includes('information has been omitted and filed separately')
  );
};

const scoreCitationAgainstCell = (
  citation: SourceCitation,
  cell?: ExtractionCell | null
): number => {
  if (!cell) return 0;

  const quoteProbe = (cell.quote || '').trim();
  const valueProbe = (cell.value || '').trim();
  const reasoningProbe = (cell.reasoning || '').trim().slice(0, 280);
  const dateProbes = expandIsoDateProbes(valueProbe);
  const snippet = (citation.snippet || '').trim();
  const normSnippet = normalizeForMatch(snippet);
  let score = 0;

  if (snippet) {
    if (quoteProbe) {
      score += 2.4 * overlapScore(snippet, quoteProbe);
      const normQuote = normalizeForMatch(quoteProbe);
      if (normQuote && normQuote.length >= 8 && normSnippet.includes(normQuote)) {
        score += 1.6;
      }
    }
    if (valueProbe) {
      score += 2.2 * overlapScore(snippet, valueProbe);
      const normValue = normalizeForMatch(valueProbe);
      if (normValue && normValue.length >= 6 && normSnippet.includes(normValue)) {
        score += 1.4;
      }
    }
    if (reasoningProbe) {
      score += 0.8 * overlapScore(snippet, reasoningProbe);
    }
    dateProbes.forEach((probe) => {
      score += 1.1 * overlapScore(snippet, probe);
      const normProbe = normalizeForMatch(probe);
      if (normProbe && normSnippet.includes(normProbe)) {
        score += 1.5;
      }
    });

    if (isBoilerplateSnippet(snippet)) {
      const maxCoreOverlap = Math.max(
        overlapScore(snippet, quoteProbe),
        overlapScore(snippet, valueProbe)
      );
      if (maxCoreOverlap < 0.18) {
        score -= 0.9;
      } else {
        score -= 0.25;
      }
    }
  }

  if (citation.bbox?.length === 4) score += 0.25;
  if (citation.selector) score += 0.2;
  if (typeof cell.page === 'number' && citation.page === cell.page) score += 0.3;

  return score;
};

const pickPrimaryCitationWithScore = (
  citations: SourceCitation[] | undefined,
  cell?: ExtractionCell | null
): { citation: SourceCitation | null; score: number } => {
  const citation = pickPrimaryCitation(citations, cell);
  if (!citation) {
    return { citation: null, score: 0 };
  }
  return {
    citation,
    score: scoreCitationAgainstCell(citation, cell),
  };
};

export const pickPrimaryCitation = (
  citations: SourceCitation[] | undefined,
  cell?: ExtractionCell | null
): SourceCitation | null => {
  if (!citations || !citations.length) return null;
  const viable = citations.filter((c) => Boolean(c.snippet || c.selector || c.page || c.bbox));
  const pool = viable.length ? viable : citations;

  if (!cell) {
    return pool[0] || null;
  }

  const scored = pool.map((citation) => ({
    citation,
    baseScore: scoreCitationAgainstCell(citation, cell),
  }));
  if (!scored.length) {
    return pool[0] || null;
  }

  let best = scored[0];
  scored.forEach((entry) => {
    if (entry.baseScore > best.baseScore) {
      best = entry;
    }
  });

  if (cell?.field_key) {
    const ranked = [...scored].sort((a, b) => b.baseScore - a.baseScore);
    const gap = ranked.length > 1 ? ranked[0].baseScore - ranked[1].baseScore : Number.POSITIVE_INFINITY;
    if (gap < 0.4) {
      let boostedBest = scored[0];
      let boostedBestScore = scored[0].baseScore + earlyPageBoost(cell.field_key, scored[0].citation.page);
      scored.forEach((entry) => {
        const boostedScore = entry.baseScore + earlyPageBoost(cell.field_key, entry.citation.page);
        if (boostedScore > boostedBestScore) {
          boostedBest = entry;
          boostedBestScore = boostedScore;
        }
      });
      return boostedBest.citation || pool[0] || null;
    }
  }

  return best.citation || pool[0] || null;
};

const scoreBlockAgainstCell = (block: ArtifactBlock, probes: string[], pageHint?: number): number => {
  if (!block.text || !block.citations?.length) return 0;
  const normBlock = normalizeForMatch(block.text);
  let score = 0;

  probes.forEach((probe) => {
    const normProbe = normalizeForMatch(probe);
    if (!normProbe) return;
    if (normBlock.includes(normProbe)) {
      score += 2.5;
    } else {
      score += overlapScore(block.text, probe);
    }
  });

  if (typeof pageHint === 'number' && block.citations.some((citation) => citation.page === pageHint)) {
    score += 0.3;
  }

  return score;
};

const pickBestBlockForCell = (document: DocumentFile, cell?: ExtractionCell | null): ArtifactBlock | null => {
  const blocks = document.artifact?.blocks || [];
  if (!blocks.length) return null;

  const probes = [cell?.quote, cell?.value]
    .map((value) => (value || '').trim())
    .filter(Boolean) as string[];

  if (!probes.length) return null;

  let bestBlock: ArtifactBlock | null = null;
  let bestScore = 0;

  blocks.forEach((block) => {
    const score = scoreBlockAgainstCell(block, probes, cell?.page);
    if (score > bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  });

  return bestScore >= 0.2 ? bestBlock : null;
};

const pickBestCitationFromArtifact = (
  document: DocumentFile,
  cell?: ExtractionCell | null
): { citation: SourceCitation | null; score: number } => {
  const blocks = document.artifact?.blocks || [];
  if (!blocks.length || !cell) {
    return { citation: null, score: 0 };
  }

  const probes = [cell.quote, cell.value]
    .map((value) => (value || '').trim())
    .filter(Boolean) as string[];
  probes.push(...expandIsoDateProbes((cell.value || '').trim()));

  let bestCitation: SourceCitation | null = null;
  let bestScore = 0;
  blocks.forEach((block) => {
    if (!block?.citations?.length) return;
    const blockScore = scoreBlockAgainstCell(block, probes, cell.page);
    block.citations.forEach((citation) => {
      const citationScore = scoreCitationAgainstCell(citation, cell);
      const combinedScore = citationScore + 0.35 * blockScore;
      if (combinedScore > bestScore) {
        bestCitation = citation;
        bestScore = combinedScore;
      }
    });
  });

  return { citation: bestCitation, score: bestScore };
};

export const resolvePrimaryCitation = (
  document: DocumentFile,
  cell?: ExtractionCell | null
): SourceCitation | null => {
  const direct = pickPrimaryCitationWithScore(cell?.citations, cell);
  const globalCandidate = pickBestCitationFromArtifact(document, cell);

  if (globalCandidate.citation && globalCandidate.score >= Math.max(0.35, direct.score + 0.55)) {
    return globalCandidate.citation;
  }
  if (direct.citation) {
    return direct.citation;
  }

  const bestBlock = pickBestBlockForCell(document, cell);
  return pickPrimaryCitation(bestBlock?.citations, cell);
};

export const centerVerticalScroll = (
  scrollContainer: HTMLElement,
  targetTop: number,
  targetHeight: number,
  smooth: boolean = true
): void => {
  const desiredTop = Math.max(0, targetTop - scrollContainer.clientHeight / 2 + targetHeight / 2);
  scrollContainer.scrollTo({
    top: desiredTop,
    left: 0,
    behavior: smooth ? 'smooth' : 'auto',
  });
};
