# Nova Solution prototype

Nova is a first recruiter screen that can be tried in chat or voice. Both modes use the same interview controller, role knowledge, transcript, progress view, and recruiter evidence note.

## Run locally

```sh
node server.js
```

Open http://localhost:4173. Chat is ready immediately. In a supported browser, choose **Voice** and allow microphone access to use browser speech for a local preview.

## Configure the language model

Copy `.env.example` to `.env` and add a model key. Muse Spark is selected when `LLM_FALLBACK_API_KEY` is set with `LLM_PRIMARY=meta`; otherwise configure Gemini with `LLM_API_KEY`. Provider credentials stay on the server. The built-in interview lines remain available if a model is not configured.

The interview controller decides the phase, next goal, and whether to follow up. The language model phrases eligible replies using that decision and retrieved role facts. It cannot skip a stage or make up a job detail.

## Choose a voice provider

Open **Settings** in the left navigation and select **Vapi** or **LiveKit**. Settings is the runtime control surface for the LLM, voice kit, microphone processing, interruption behavior, endpointing, and LiveKit speech models. Every control shows its effective default, and **Restore defaults** returns to the server configuration.

The selected voice settings are normalized by the server and passed into the next session. LiveKit receives the interruption, endpointing, AEC warmup, preemptive-generation, STT, and TTS values in its agent dispatch metadata. The browser applies echo cancellation, noise suppression, and automatic gain control to the microphone track. Vapi receives the matching speaking, stopping, denoising, silence timeout, and duration plans through its assistant configuration. Both providers still use the same Nova interview controller, chat transcript, role progress, and recruiter note.

## Configure Vapi voice

Local preview uses browser speech recognition and system speech synthesis, so it does not need Vapi credentials. For Vapi transcription and the configured Vapi voice on a hosted demo:

1. Deploy the app at a public HTTPS address so Vapi can reach its Muse response endpoint.
2. Add a Vapi **public** key to `VAPI_PUBLIC_KEY` and choose a voice with `VAPI_VOICE_ID` (the default is Jess, a youthful, energetic female voice).
3. Restrict the public key to the demo’s origin and enable transient assistants, since the app sends a session-specific inline assistant configuration.

Vapi’s Web SDK needs a public key in the browser. Keep private Vapi keys server-side; a private key is not a replacement for the Web SDK public key.

## Configure LiveKit voice

Add `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` to the server's `.env` (or deployment secrets). The API secret stays on the server. Then install the worker dependency and start the app and worker in separate terminals:

```sh
npm install
node server.js
```

```sh
npm run livekit:dev
```

In **Settings**, choose **LiveKit**, open **Voice**, and start the screen. The backend creates a short-lived room token and explicitly dispatches the named Nova agent. The worker uses LiveKit speech recognition and a young, upbeat Cartesia voice; each transcript is sent to Nova's existing interview controller, so LiveKit does not make a separate interview decision.

LiveKit's speech services may incur usage when a voice session starts. For a deployed worker, set `NOVA_APP_URL` to the app's public HTTPS origin so the worker can reach the same controller. Deploy the agent worker with the LiveKit CLI (`lk agent create`) or run it locally with `npm run livekit:dev`; the app server and worker are separate processes.

## Interview flow

The opening identifies Nova as an AI recruiter, names the role, says the candidate can stop at any time, and immediately asks the first role question. Nova then stays with vague answers, follows a useful detail once, answers candidate questions from role knowledge, and pauses when a candidate has not finished. The post-call note summarizes evidence heard; it is not a hiring prediction.

The **Fixed call script** option is a comparison baseline that demonstrates the reported call problems. The **Walkthrough** explains each problem, the product behavior built for it, and what evidence is still needed.
