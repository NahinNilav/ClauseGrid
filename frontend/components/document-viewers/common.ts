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

const scoreCitationAgainstCell = (
  citation: SourceCitation,
  cell?: ExtractionCell | null
): number => {
  if (!cell) return 0;

  const quoteProbe = (cell.quote || '').trim();
  const valueProbe = (cell.value || '').trim();
  const reasoningProbe = (cell.reasoning || '').trim().slice(0, 280);
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
  }

  if (citation.bbox?.length === 4) score += 0.25;
  if (citation.selector) score += 0.2;
  if (typeof cell.page === 'number' && citation.page === cell.page) score += 0.3;

  return score;
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

  let best = pool[0] || null;
  let bestScore = -1;
  pool.forEach((citation) => {
    const score = scoreCitationAgainstCell(citation, cell);
    if (score > bestScore) {
      bestScore = score;
      best = citation;
    }
  });

  return best || pool[0] || null;
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

export const resolvePrimaryCitation = (
  document: DocumentFile,
  cell?: ExtractionCell | null
): SourceCitation | null => {
  const direct = pickPrimaryCitation(cell?.citations, cell);
  if (direct) return direct;

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
