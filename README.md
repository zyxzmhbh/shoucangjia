# Shoucangjia Favorites (SillyTavern Extension)

A SillyTavern extension for highlighting and saving chat text with snapshots.

## MVP Features

- Select text in a message, then click `Save` or `Highlight + Save`
- Optional note input when saving
- Favorites panel with filters:
  - character name
  - chat/session ID
  - note text
- Saved snapshot includes:
  - selected text
  - save time
  - session identifiers
  - character card snapshot
  - nearby chat context (5 above + 5 below)
- Favorites still viewable even if original card/chat is deleted
- Export/Import JSON for backup

## Install (Git URL)

Use this repo URL in SillyTavern Extension installer:

```text
https://github.com/zyxzmhbh/shoucangjia.git
```

## Usage

1. Select text inside chat.
2. Click `Save` or `Highlight + Save`.
3. Add note (optional).
4. Open `Favorites` button at bottom-right to browse snapshots.

## Storage

- Data is stored in `extension_settings.shoucangjia`.
- This is persisted by SillyTavern settings storage, not plain browser-only localStorage.
- Export JSON regularly as backup.

## Known MVP Limits

- Highlight re-apply is text-match based and may miss complex cross-node selections.
- Future improvements: tags, full-text search, batch actions, compression/archiving.
