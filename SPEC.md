# RView specification

RView lets a person browse and review images in a selected local directory.
The desktop window and browser UI share the following requirements.

## Must

1. Show PNG, JPEG, WebP, BMP and GIF images as thumbnails and in a viewer,
   with previous/next navigation, zoom, pan and fullscreen controls.
2. Keep large folders usable: load originals on demand, show previews no larger
   than 320 pixels near the visible thumbnail area, and release offscreen images.
3. Show the selected folder name in the window title, allow folder changes and
   previous/next nonempty sibling navigation, and discard responses from an old folder.
4. Move favorites into sibling folders suffixed with `f` or `g`. Keep an existing
   identical file, preserve different same-name content under a numbered filename,
   and remove a successfully moved image from the viewer before advancing.
5. Append ratings of +2, -2, +1 or -1 to `rview-ratings.jsonl` beside the images
   without modifying the images. Advance only after a successful save; keep the
   last image selected. The latest record for a filename is its current rating.
6. Offer deletion and Save As; provide clipboard copying on Windows. Failed
   favorite operations must keep the selected source image available.
7. Provide the documented keyboard shortcuts for navigation, ratings, favorites,
   folders and menus. Close an open menu on an outside click and ignore the
   click that restores window focus for menu opening.
8. Run browser mode on loopback by default, with explicit host/port options and
   an option to suppress browser launch. Serve requested images only from the
   selected directory; browser mode has no authentication.

## Verification

`test/test_media.py` checks metadata-only lists, preview size, original retrieval,
directory boundaries and rating persistence for both Python backends.
`test/test_favorites.py` checks moves, collisions and failure preservation.
`test/test_browser.py` uses Chromium and synthetic images to check large-folder
browsing, keyboard controls, stale responses and favorite selection updates.

Native desktop focus, Windows clipboard, dialogs and executable builds require
checks on the target desktop OS. See README for rebuild steps and tested scope.
