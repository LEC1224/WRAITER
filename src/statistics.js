import { nodeText, wordCount } from './document.js';

const wordsOf = text => String(text || '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
const blockTypes = new Set(['paragraph', 'heading', 'codeBlock']);

function blocksOf(node, output = []) {
  if (!node) return output;
  if (blockTypes.has(node.type)) output.push(nodeText(node, '\n'));
  for (const child of node.content || []) blocksOf(child, output);
  return output;
}

function sentenceCount(text, language) {
  if (!text.trim()) return 0;
  try { return [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)].filter(item => item.segment.trim()).length; }
  catch { return (text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || []).filter(value => value.trim()).length; }
}

function quoteWords(text) {
  let count = 0;
  for (const match of text.matchAll(/[“"]([^”"]+)[”"]/gu)) count += wordCount(match[1]);
  return count;
}

export function documentStatistics(project, wordsPerPage = 250) {
  const language = project.language || 'en-US';
  const chapters = project.chapters.map((chapter, index) => {
    const blocks = blocksOf(chapter.content), text = blocks.join('\n');
    return {
      id: chapter.id,
      number: index + 1,
      title: chapter.title,
      words: wordCount(text),
      characters: text.length,
      paragraphs: blocks.filter(value => value.trim()).length,
      sentences: sentenceCount(text, language)
    };
  });
  const texts = project.chapters.map(chapter => nodeText(chapter.content, '\n'));
  const text = texts.join('\n\n'), words = wordsOf(text), normalized = words.map(word => word.toLocaleLowerCase(language));
  const uniqueWords = new Set(normalized).size, letters = words.reduce((sum, word) => sum + [...word].length, 0);
  const sentences = sentenceCount(text, language), paragraphs = chapters.reduce((sum, chapter) => sum + chapter.paragraphs, 0);
  const longest = [...chapters].sort((a, b) => b.words - a.words)[0] || null;
  const shortest = [...chapters].filter(chapter => chapter.words).sort((a, b) => a.words - b.words)[0] || null;
  const dialogueWords = quoteWords(text);
  return {
    chapters: chapters.length,
    words: words.length,
    uniqueWords,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/gu, '').length,
    paragraphs,
    sentences,
    pages: words.length ? Math.ceil(words.length / Math.max(1, wordsPerPage)) : 0,
    wordsPerPage,
    readingMinutes: words.length / 220,
    speakingMinutes: words.length / 150,
    averageWordLength: words.length ? letters / words.length : 0,
    averageSentenceLength: sentences ? words.length / sentences : 0,
    averageParagraphLength: paragraphs ? words.length / paragraphs : 0,
    vocabularyDiversity: words.length ? uniqueWords / words.length : 0,
    dialoguePercent: words.length ? dialogueWords / words.length : 0,
    longest,
    shortest,
    chaptersDetail: chapters
  };
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 1) return '<1 min';
  const rounded = Math.round(minutes), hours = Math.floor(rounded / 60), rest = rounded % 60;
  return hours ? `${hours} hr${hours === 1 ? '' : 's'}${rest ? ` ${rest} min` : ''}` : `${rounded} min`;
}
