# Multimodality Questionnaire — GitHub Preview

This repository is an independent, static collaborator preview of the
multimodality questionnaire.

- It uses the frozen public catalog with 272 sequences.
- Table is rendered as HTML.
- Graph and Video retain the audited original assets and hashes.
- GitHub Pages serves the application while the same repository's raw-file
  endpoint serves the original Graph, Video, and terminal-frame assets. This
  keeps the Pages deployment well below its site-size ceiling.
- The locally verified production build is published from the `gh-pages`
  branch; the research source and audited assets remain on `main`.
- The five questions are sampled with the same client-side research rules as
  the production questionnaire.
- There is no server or shared database. A completed response is stored only
  in the current browser and can be downloaded as JSON/CSV.
- Private `y21` outcomes, source workbooks, credentials, and participant data
  are intentionally excluded.

Direct format checks:

- `?preview=1&format=table`
- `?preview=1&format=graph`
- `?preview=1&format=video`

The production Tencent deployment remains in a separate project and is not
modified by this preview.
