import { SourceCitation } from '../../types';

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

export const pickPrimaryCitation = (citations: SourceCitation[] | undefined): SourceCitation | null => {
  if (!citations || !citations.length) return null;
  return citations.find((c) => Boolean(c.snippet || c.selector || c.page || c.bbox)) || citations[0] || null;
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
