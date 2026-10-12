# Expected interactions in WRAITER

Reviewed on 2026-10-12 after a File Explorer image drop failed. This is an audit of the current local source and isolated desktop checks, with synthetic documents. All seven gaps below have now been implemented and exercised in desktop tests. The baseline column records the behavior that prompted each change.

## Fixed in this change

The editor had an image node and a file-picker button, but no handler for dropped files or clipboard images. The image extension displays pictures; importing file bytes is a separate responsibility ([Tiptap image documentation](https://tiptap.dev/docs/editor/extensions/nodes/image)).

- File Explorer drops now embed PNG, JPEG, GIF and WebP files at the pointer, including drops on page margins and in focus/divided-page views.
- Clipboard images/screenshots and the toolbar picker insert at the captured cursor or selection. Multiple files retain their order and undo together.
- A dashed drop target, progress, success and actionable error messages replace silent failure. Valid images in a mixed drop still import.
- Imports follow edits at their original location and cancel when the editor/chapter changes. Moving an existing image remains an ordinary editor move.
- Images survive source-file moves and application restarts, with persistent undo/redo. Uppercase JPG picker filenames now produce the correct embedded MIME type.
- Linked/unsupported images in formatted paste/drop become labelled placeholders instead of unsaveable external image nodes. Other text and formatting are retained. Dropping files elsewhere cannot navigate away from WRAITER.

Image controls, Find, chapter gestures, links, tab actions, document/reference drops and unified zoom are covered by `npm run test:ux`. Edited dimensions and descriptions round-trip through ODT/DOCX in `npm run test:io`. The implementation uses `src/images.js`, `src/ImageProperties.jsx`, `src/ChapterOutline.jsx`, `src/ProjectTabs.jsx`, `src/document-ux.js`, and the existing renderer/native import, menu, workspace and preference routes.

`npm run test:images` checks these behaviors through the desktop app, using Chromium protocol file drags and synthetic clipboard events. The tests do not physically drive File Explorer or change the user's clipboard.

## Seven audited gaps, now implemented

| Priority | What a writer tries | Baseline behavior and evidence | Implemented behavior |
| --- | --- | --- | --- |
| High | Select a picture, drag its corner to resize it, or edit its description. | Images are selectable and draggable, but resizing is disabled and there is no image-properties control. See `electron/editor-schema.mjs`, `src/App.jsx` and `src/styles.css`. | Selected images expose resize handles and a description field; aspect ratio is preserved by default. Size/description changes undo together and survive WRAITER, DOCX and ODT save/reopen. |
| High | Drop a document onto WRAITER, or a reference file onto Reference library. | File opening and reference linking exist only through pickers/menu actions. Image drops now give guidance for other file types. The writing page and reference panel have no document/reference drop route. See `src/App.jsx`, `electron/main.cjs` and `electron/preload.cjs`. | Supported document drops open a project tab without replacing prose. The reference panel visibly accepts reference files. Mixed/unsupported drops explain which files were accepted; existing native-save compatibility checks still apply. |
| High | Select a phrase and press Ctrl+F; press Ctrl+F again while Find is open; continue navigating matches from the keyboard. | Find does not seed the selection. Reopening an already visible panel only sets the same boolean, so its initial focus effect does not run again. Activating a result focuses the editor; F3/Shift+F3 have no dedicated route. See `handleCommand`/`navigatePassage` in `src/App.jsx`, `src/SearchPanel.jsx` and `src/hotkeys.js`. | Ctrl+F always focuses/selects the query and offers the selected phrase. Enter/Shift+Enter in the field and F3/Shift+F3 outside it move through matches. Escape returns focus to the passage without editing it. |
| Medium | Drag chapters into reading order; double-click an outline title to rename it. | The outline has selection buttons; ordering uses up/down buttons in the active chapter header. No chapter drag or outline rename handler exists. See `reorderChapter` and the chapter-list markup in `src/App.jsx`. | A clear insertion marker previews chapter order. Drop changes the order once and is undoable; keyboard move controls remain available. Double-click/F2 opens a title edit with Enter to commit and Escape to cancel. |
| Medium | Ctrl+click a link to open it, or press Ctrl+K to create/edit it. | Link clicking is disabled in the schema. The editor click handler only handles comments; there is no Ctrl+click route, Mod+K binding or link action in the editor context menu. Window navigation is also blocked. See `electron/editor-schema.mjs`, `src/Editor.jsx`, `src/hotkeys.js`, `electron/context-menu.cjs` and `createWindow` in `electron/main.cjs`. | Ctrl+click opens allowed http/https/mailto links in the default application while ordinary clicking keeps editing. Ctrl+K edits the current link or selected passage; right-click offers Open/Edit/Remove. |
| Medium | Middle-click a project tab, right-click it for tab actions, or drag it into another position. | Tabs support their close button, Ctrl+W, Ctrl+Tab and arrow-key cycling. There are no middle-click, tab context-menu or tab drag handlers. See the project-tabs markup in `src/App.jsx`. | Middle-click closes the intended tab using existing save/recovery behavior. Context actions operate on the clicked tab; dragging persists tab order across restart. Keyboard equivalents remain available. |
| Medium | Use the View menu, keyboard zoom or Ctrl+wheel and see one consistent document-zoom value. | The status bar changes `prefs.zoom` for the document; View uses Electron's whole-window `zoomIn`/`zoomOut`/`resetZoom` roles. The two controls affect different scales. See `electron/desktop.cjs` and the document-zoom control in `src/App.jsx`. | Menu, shortcuts, Ctrl+wheel and the percentage control use one document-zoom model, preserve the reading position and update the percentage. Interface scaling is a separate clearly named setting if retained. |

An isolated desktop gesture pass also reproduced the blank selected-phrase search, failure to refocus an open Find field, focus moving to the editor after Enter, absent Ctrl+click/Ctrl+K link actions, ignored middle-click tab closing, and missing outline rename/drag gestures. Evidence: `test-output/ux-observations-zE1o6m/observations.json`. Those observations describe the baseline. `npm run test:ux` now verifies F3/Shift+F3, native View-menu zoom, zoom shortcuts and Ctrl+wheel, together with the other six improvements. The final desktop suite also passes against the packaged application.

## Implementation sequence (completed)

1. Finish the image workflow with resizing and image properties.
2. Add document/reference drops with clear destination feedback.
3. Repair Find focus and keyboard navigation; add Ctrl+K and native link actions.
4. Add chapter/tab gestures and unify document zoom.

## A repeatable discovery pass

For each visible object, try the action its shape suggests: drop a file onto a page, drag an ordered item, double-click its title, right-click it, and use its familiar shortcut. Then repeat through the keyboard, at the minimum window size, and after switching chapters or reopening the app. Test cancellation and undo as part of the interaction rather than only checking that a button works.

Record the attempted gesture, expected result, actual result, recovery path and evidence. Before adding a new feature, check whether an existing capability is merely missing another entry point. WRAITER already has persistent undo/recovery, native context menus, formatting copy/paste, project shortcuts, scoped search and compatibility-aware file opening; new gestures should reuse those paths.
