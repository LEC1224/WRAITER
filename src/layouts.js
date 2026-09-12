export const LAYOUTS = {
  story: { name: 'Story', description: 'Clean prose with chapter headings.', showStatistics: false, fontFamily: 'Cambria', fontSize: 12, lineHeight: 1.5, measure: 720 },
  article: { name: 'Article', description: 'Headlines, word count and reading time.', showStatistics: true, fontFamily: 'Georgia', fontSize: 12, lineHeight: 1.65, measure: 720 },
  manuscript: { name: 'Submission manuscript', description: 'Double-spaced prose for review.', showStatistics: false, fontFamily: 'Times New Roman', fontSize: 12, lineHeight: 2, measure: 720 },
  report: { name: 'Report', description: 'Compact document text and clear headings.', showStatistics: false, fontFamily: 'Calibri', fontSize: 11, lineHeight: 1.3, measure: 760 },
  notes: { name: 'Notes', description: 'A compact working document.', showStatistics: false, fontFamily: 'Segoe UI', fontSize: 11, lineHeight: 1.4, measure: 760 }
};
export const documentLayout = project => LAYOUTS[project?.layout] || LAYOUTS.story;
