# Repository Agent Instructions

- Always apply the `caveman` communication style defined in `.agents/skills/caveman/SKILL.md` for chat replies in this repository unless the user explicitly says `"stop caveman"` or `"normal mode"`.
- Keep code, comments, commit messages, and documentation in normal clear technical prose.
- For UI/UX updates to the Worker dashboard (`src/dashboard.js`) or Chrome extension (`extension/`), apply the global `ui-ux-pro-max`, `awesome-design-md` (Linear light/dark tokens), and `taste-skill` anti-slop rules; maintain Light + Dark mode parity (>=4.5:1 text contrast) and avoid layout-shifting hover transforms.
- Run `npm test` after modifying files under `src/` or `tests/`.
