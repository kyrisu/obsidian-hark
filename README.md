# Hark

> **⚠️ Draft README — skeleton only.** This file is structurally complete but is
> not release-ready. Items that need the maintainer before v1.0 ship:
> screenshots / a demo GIF, the confirmed Gemini API price, and a pass over every
> UX claim once Phases 3–7 have been manually verified. Search this file for
> `TODO:` markers.

Read your markdown notes aloud in Obsidian using Google's **Gemini 2.5
Flash TTS**. The currently-spoken sentence is highlighted in Live Preview and
Source mode as playback advances. Audio is cached locally, so re-listening to a
note costs nothing.

<!-- TODO: add one screenshot or GIF showing the floating mini-player and the
     sentence highlight in Live Preview. -->

## Requirements

- Obsidian **1.11.4** or newer (the plugin uses `SecretStorage`, introduced in 1.11.4).
- A Google **Gemini API key** — a single key, no second service required.

## Getting a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/) and sign in with a Google account.
2. Click **Get API key** and create a key (a new or existing Google Cloud project).
3. Copy the key. In Obsidian, open **Settings → Hark**, paste the key into the **Gemini API key** field, and click **Validate**.

The key is stored in Obsidian's `SecretStorage` rather than in the plugin's
`data.json`. The plugin calls the Gemini Developer API at
`generativelanguage.googleapis.com`.

<!-- TODO: add screenshots of the AI Studio "Get API key" page and the plugin
     settings credential field. -->

## Cost

Synthesis is billed by the Gemini Developer API for the
`gemini-2.5-flash-preview-tts` model. Once a paragraph is synthesised it is
cached locally, so replays of the same note and voice are free.

<!-- TODO: quote the current Gemini Developer API TTS rate from
     https://ai.google.dev/pricing and give a worked example (e.g. cost of a
     1,000-word note). Do NOT reuse the old Cloud-TTS "$15 / 1M chars" figure —
     that was a different product. -->

## Installation

Until the plugin is in the community catalogue, install it from a local build:

1. Clone this repository.
2. Run `npm install` then `npm run build` — this produces `main.js`.
3. Copy (or symlink) `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/hark/`.
4. In Obsidian, enable **Hark** under **Settings → Community plugins**.

## Usage

Open a markdown note, then either click the **Read note aloud** ribbon icon
(the audio-file icon in the left ribbon) or run one of the commands below from
the command palette. A draggable floating mini-player appears with play/pause,
stop, previous/next paragraph, a speed selector, and a seek bar; the status bar
also shows playback state.

Commands (no default hotkeys — assign your own under **Settings → Hotkeys**):

| Command | What it does |
| --- | --- |
| Read note aloud from cursor | Starts at the paragraph the cursor is in |
| Read note aloud from beginning | Starts at the top of the note |
| Read selection aloud | Reads only the selected text (also on the right-click menu) |
| Pause or resume reading | Toggles playback |
| Stop reading | Stops and clears the highlight |
| Skip to next paragraph | Jumps forward one paragraph |
| Go back one paragraph | Jumps back one paragraph |
| Increase reading speed | +0.25× (range 0.5×–2.0×) |
| Decrease reading speed | −0.25× |
| Clear cache | Deletes all cached audio |

To read part of a note, select the text (a selection may span multiple
paragraphs), then right-click and choose **Read selection aloud** or run the
command. Multi-paragraph selections are trimmed to the selection bounds.

<!-- TODO: re-verify every command name, the ribbon tooltip, and the
     floating-player controls against the running plugin after manual
     verification of Phases 3–7. -->

## OS Now Playing controls

While a note is playing, Hark registers with the operating system's media
controls. The current note's title appears as the track, with "Hark" as the
artist, and you can play, pause, stop, and skip to the previous or next
paragraph from the OS — including hardware media keys and lock-screen or
menu-bar widgets, without Obsidian in focus.

This is verified on **macOS** (the Now Playing widget in Control Center and the
menu bar). It is expected to work on **Windows** (System Media Transport
Controls) and **Linux** (MPRIS) too, since all three use the same Chromium
media-session layer, but those have not been tested directly. **Android is not
supported** (see Known limitations).

One quirk: pressing skip-previous or skip-next while paused resumes playback,
matching how most media apps behave.

## Privacy & data flow

When you read a note aloud, the text of each paragraph is sent to Google's
Gemini Developer API for synthesis. Review Google's data-use and retention
terms for the Gemini API before using the plugin with sensitive notes; note
that free-tier and paid-tier data handling differ. No text is sent anywhere
else, and nothing is sent for paragraphs already in the local cache.

## Cache

Synthesised audio (WAV) and sentence-timing data are content-hashed and stored
in `<your-vault>/.hark-cache/`. The dot-prefixed folder name keeps the cache out
of Obsidian Sync. The cache uses LRU eviction under a size limit configurable
in settings; you can also clear it from the settings tab or the **Clear cache**
command.

## Known limitations

- **Sentence highlighting is tuned for `.` `!` `?` punctuation.** Gemini
  auto-detects the spoken language, so playback works across many languages —
  English, Spanish, Polish, and other European languages are well covered.
  Languages that do not end sentences with `.`, `!`, or `?` (such as Chinese or
  Japanese) still play correctly, but the highlight treats the whole paragraph
  as a single block.
- **Sentence-level highlight only.** Playback highlights the whole current
  sentence, not individual words, because Gemini returns no word-level
  timestamps. Sentence boundaries are anchored to pauses detected in the audio,
  so on dense passages the highlight can run ahead by under a second before the
  next boundary realigns it. Measured word-level timing is the headline v1.1
  feature.
- **Reading mode plays audio but does not highlight.** The highlight is a Live
  Preview / Source mode feature in v1.0.
- **Mobile loads but is not actively tested** in v1.0.
- **Android does not support OS Now Playing controls** — a structural limitation
  of the Capacitor WebView.
- **AirPods media keys on macOS** may not register, due to an upstream Electron bug.
- **A brief (~50 ms) gap** can be heard between paragraphs.

## License

[0-BSD](LICENSE).
