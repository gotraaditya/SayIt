# SayIt Social Copy

## LinkedIn

I built SayIt, a small local-first Windows utility that reads selected text aloud with one global shortcut.

The project started with a simple friction point: text-to-speech is useful, but the usual copy, switch, paste, and play workflow pulls people away from what they are reading.

I designed SayIt to feel more like an operating-system action than a separate destination. Select text in any application, press `Alt + S`, and a compact always-on-top widget handles private, on-device playback with live captions.

The interesting work was in the details:

- keeping the widget useful without covering the source material
- showing current and upcoming captions so listening has a sense of place
- restoring the clipboard after selection capture
- splitting long selections into bounded sentence-aware requests
- keeping the speech service on a restricted loopback connection
- making cancellation, startup, and failure states recoverable

The current v0.1 spans React, Tauri/Rust, FastAPI, and Kokoro, with 53 passing automated tests across the three layers.

It is not a giant product, and that is part of why I enjoyed it. It was a chance to treat a focused utility with the same care I would bring to a larger system: clear intent, explicit trade-offs, privacy by architecture, and honest validation.

I am publishing the project as open source. The carousel shares the product and interaction decisions behind it.

#ProductDesign #UXDesign #OpenSource #Tauri #Accessibility

## Instagram

SayIt turns selected text into private, on-device speech with one shortcut.

Select text anywhere in Windows. Press `Alt + S`. Listen from a compact caption-led widget without switching apps or sending the text to a cloud service.

This case study covers the interaction model, local-first architecture, resilient states, and the trade-offs behind the v0.1 build.

Small project. Real product thinking.

#ProductDesign #UXCaseStudy #OpenSource #DesktopApp #Accessibility

## Carousel Alt Text

1. SayIt cover: the app icon, highlighted text, Alt + S shortcut, audio waveform, and compact reading widget.
2. Comparison between a conventional multi-step text-to-speech workflow and SayIt's one-gesture flow.
3. Four product principles: one gesture, quiet presence, local processing, and explicit state.
4. Three-step interaction: select text, invoke the shortcut, and listen with captions.
5. The compact resting widget and expanded reading state with dimensions and control annotations.
6. Caption hierarchy showing previous, current, and next lines with accessibility notes.
7. Local architecture from selected text through Tauri, React, FastAPI, Kokoro, and private audio playback.
8. Resilience details and validation metrics, including 53 passing tests.
9. Validated product capabilities alongside known v0.1 trade-offs.
10. Reflection on designing a small utility with deliberate product standards.
