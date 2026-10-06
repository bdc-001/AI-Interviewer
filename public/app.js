const statusLabel = {
  later: "Not yet",
  now: "Asking",
  "follow-up": "Staying here",
  solid: "Specific",
  thin: "Still general",
  partial: "Named it",
  missing: "Not heard",
  asked: "Asked",
};

const flowSteps = [
  { key: "intro", title: "Introduction", detail: "AI identity, role, and first question" },
  { key: "screen", title: "Explore role goals", detail: "Three questions, with room to explain" },
  { key: "close", title: "Close and hand off", detail: "Next steps and recruiter note" },
];

let roles = [];
let roleId = "engineer";
let mode = "listening";
let session = null;
let busy = false;
let conversationMode = "chat";
let audience = "interviewee";
try { audience = localStorage.getItem("nova-audience") === "recruiter" ? "recruiter" : "interviewee"; } catch {}
let voiceClient = null;
let voiceConfig = null;
let voicePollTimer = null;
let voiceConnected = false;
let livekitClient = null;
let livekitMuted = false;
let livekitAudioNodes = [];
let voiceProvider = "";
try { voiceProvider = localStorage.getItem("nova-voice-provider") || ""; } catch {}
let VapiSdk = null;
let LiveKitSdk = null;
let browserRecognition = null;
let browserVoiceActive = false;
let browserVoiceMuted = false;
let browserVoicePending = false;

const $ = (sel) => document.querySelector(sel);
const appShell = $("#app-shell");

try {
  const savedSidebarState = localStorage.getItem("nova-sidebar-collapsed");
  appShell.classList.toggle("sidebar-collapsed", savedSidebarState === null ? window.innerWidth < 1180 : savedSidebarState === "true");
} catch {}
$("#sidebar-toggle").setAttribute("aria-expanded", String(!appShell.classList.contains("sidebar-collapsed")));
$("#sidebar-toggle").setAttribute("aria-label", appShell.classList.contains("sidebar-collapsed") ? "Expand sidebar" : "Collapse sidebar");

$("#sidebar-toggle").addEventListener("click", () => {
  const collapsed = appShell.classList.toggle("sidebar-collapsed");
  $("#sidebar-toggle").setAttribute("aria-expanded", String(!collapsed));
  $("#sidebar-toggle").setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  try { localStorage.setItem("nova-sidebar-collapsed", String(collapsed)); } catch {}
});
$("#mobile-nav-toggle").addEventListener("click", () => setMobileNav(!appShell.classList.contains("mobile-nav-open")));
$("#sidebar-backdrop").addEventListener("click", () => setMobileNav(false));
window.matchMedia("(max-width: 900px)").addEventListener("change", (event) => {
  if (!event.matches) setMobileNav(false);
});

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => show(button.dataset.nav));
});
document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => show(button.dataset.go));
});

$("#composer").addEventListener("submit", onSend);
$("#chat-mode").addEventListener("click", () => setConversationMode("chat"));
$("#voice-mode").addEventListener("click", () => setConversationMode("voice"));
$("#audience-interviewee").addEventListener("click", () => setAudience("interviewee"));
$("#audience-recruiter").addEventListener("click", () => setAudience("recruiter"));
$("#voice-start").addEventListener("click", startVoice);
$("#voice-stop").addEventListener("click", stopVoice);
$("#voice-mute").addEventListener("click", toggleVoiceMute);
$("#voice-provider").addEventListener("change", async (event) => {
  const nextProvider = event.currentTarget.value;
  if (nextProvider === voiceProvider) return;
  if (livekitClient || voiceClient || browserVoiceActive) await stopVoice();
  voiceProvider = nextProvider;
  voiceConfig = null;
  try { localStorage.setItem("nova-voice-provider", voiceProvider); } catch {}
  await saveVoiceSettings({ silent: true });
  await loadVoiceConfig();
});
$("#message").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#message").addEventListener("input", (event) => {
  const input = event.currentTarget;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});
$("#end").addEventListener("click", onEnd);
document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-ticket]");
  if (opener) {
    openTicket(opener.dataset.ticket);
    return;
  }
  if (event.target.closest("[data-close]")) closeTicket();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTicket();
    setMobileNav(false);
  }
});
$("#role-select").addEventListener("change", onSetupChange);
$("#ticket-search").addEventListener("input", renderBoard);
["#ticket-type", "#ticket-priority", "#ticket-scope"].forEach((selector) => {
  $(selector).addEventListener("change", renderBoard);
});
$("#llm-save").addEventListener("click", saveModel);
$("#voice-save").addEventListener("click", () => saveVoiceSettings());
$("#voice-reset").addEventListener("click", async () => {
  if (!voiceConfig?.defaults) await loadVoiceConfig();
  await saveVoiceSettings({ providedSettings: voiceConfig?.defaults });
});
$("#llm-clear").addEventListener("click", async () => {
  $("#llm-status").textContent = "Switching back to the built-in call logic…";
  const response = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "builtin" }),
  });
  renderModel(await response.json());
});
$("#prompt-role").addEventListener("change", async (event) => {
  const nextRole = event.target.value;
  if (!nextRole) return;
  roleId = nextRole;
  syncRoleSelect();
  await loadPrompt(nextRole);
  restart();
});

boot();

async function boot() {
  try {
    const response = await fetch("/api/roles");
    if (!response.ok) throw new Error("no roles");
    roles = await response.json();
    renderChoices();
    await Promise.all([restart(), loadPrompt(), loadModel()]);
  } catch {
    $("#error").hidden = false;
  }
}

function show(name) {
  const sectionNames = {
    screen: "Solution",
    brief: "Tickets",
    priorities: "Priorities",
    prompt: "Prompt",
    walkthrough: "Walkthrough",
    settings: "Settings",
  };
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === name);
  });
  document.querySelectorAll("[data-nav]").forEach((button) => {
    if (button.dataset.nav === name) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#section-title").textContent = sectionNames[name] || "Solution";
  $("#audience-switch").hidden = name !== "screen";
  if (name === "screen") {
    const log = $("#messages");
    log.scrollTop = log.scrollHeight;
  }
  if (window.matchMedia("(max-width: 900px)").matches) setMobileNav(false);
  window.scrollTo(0, 0);
}

function setMobileNav(open) {
  appShell.classList.toggle("mobile-nav-open", open);
  document.body.classList.toggle("nav-open", open);
  $("#sidebar-backdrop").hidden = !open;
  $("#mobile-nav-toggle").setAttribute("aria-expanded", String(open));
  $("#mobile-nav-toggle").setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  if (open) {
    $(".nav-item[data-nav]")?.focus();
  } else if (window.matchMedia("(max-width: 900px)").matches && (document.activeElement.closest?.("#sidebar") || document.activeElement.id === "sidebar-backdrop")) {
    $("#mobile-nav-toggle").focus();
  }
}

function renderChoices() {
  $("#role-select").innerHTML = roles
    .map((role) => `<option value="${esc(role.id)}">${esc(role.label)}</option>`)
    .join("");
  $("#role-select").value = roleId;
  $("#prompt-role").innerHTML = roles
    .map((role) => `<option value="${esc(role.id)}">${esc(role.label)}</option>`)
    .join("");
  $("#prompt-role").value = roleId;
}

function onSetupChange() {
  const nextMode = document.querySelector('input[name="mode"]:checked');
  const nextRole = $("#role-select").value || roleId;
  const pickedMode = nextMode ? nextMode.value : mode;
  if (nextRole === roleId && pickedMode === mode) return;
  roleId = nextRole;
  mode = pickedMode;
  $("#prompt-role").value = roleId;
  Promise.all([restart(), loadPrompt()]);
}

function syncRoleSelect() {
  $("#role-select").value = roleId;
}

async function restart() {
  if (voiceClient || livekitClient || browserVoiceActive) await stopVoice();
  setConversationMode("chat");
  setBusy(true);
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId, mode }),
    });
    session = await response.json();
    renderSession();
    await loadVoiceConfig();
  } catch {
    $("#error").hidden = false;
  } finally {
    setBusy(false);
  }
}

const INTERVIEWEE_NAME = "Alagu";

function setAudience(next) {
  audience = next === "recruiter" ? "recruiter" : "interviewee";
  try { localStorage.setItem("nova-audience", audience); } catch {}
  $("#screen-shell").dataset.audience = audience;
  $("#audience-interviewee").classList.toggle("is-active", audience === "interviewee");
  $("#audience-recruiter").classList.toggle("is-active", audience === "recruiter");
  $("#audience-interviewee").setAttribute("aria-pressed", String(audience === "interviewee"));
  $("#audience-recruiter").setAttribute("aria-pressed", String(audience === "recruiter"));
  $("#screen-heading").textContent = audience === "interviewee" ? `Hi ${INTERVIEWEE_NAME}!` : "AI recruiter solution";
  $("#screen-hint").textContent = audience === "recruiter"
    ? "Follow this interview through the transcript, journey, and summary."
    : "Talk with Nova in chat or voice, and end the interview when you are done.";
  syncChatCopy();
  if (session) renderSession();
}

function syncChatCopy() {
  $("#chat-mode-copy").textContent = "Live transcript";
}

function setConversationMode(nextMode) {
  conversationMode = nextMode;
  const voice = nextMode === "voice";
  $("#chat-mode").classList.toggle("is-active", !voice);
  $("#voice-mode").classList.toggle("is-active", voice);
  $("#chat-mode").setAttribute("aria-pressed", String(!voice));
  $("#voice-mode").setAttribute("aria-pressed", String(voice));
  syncChatCopy();
  $("#composer").hidden = voice || Boolean(session?.done);
  $("#chips").hidden = voice || Boolean(session?.done);
  $(".composer-hint").hidden = voice || Boolean(session?.done);
  $("#voice-dock").hidden = !voice || Boolean(session?.done);
  if (voice && !voiceClient && !livekitClient && !browserVoiceActive) loadVoiceConfig();
  if (!voice && voiceConnected) stopVoice();
}

async function loadVoiceConfig() {
  if (!session) return;
  try {
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: true, session }),
    });
    // The server settings are the source of truth. A stale browser preference
    // should not silently override the provider shown in Settings.
    const providerQuery = "";
    const response = await fetch(`/api/voice/config?sessionId=${encodeURIComponent(session.id)}${providerQuery}`);
    if (!response.ok) throw new Error("Voice settings could not be loaded for this session.");
    voiceConfig = await response.json();
    voiceProvider = voiceConfig.settings?.provider || voiceConfig.provider || voiceProvider || voiceConfig.defaultProvider || "vapi";
    $("#voice-provider").value = voiceProvider;
    applyVoiceSettings(voiceConfig.settings, voiceConfig.defaults);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const isPublicHttps = location.protocol === "https:" && !isLocal;
    voiceConfig.browserAvailable = Boolean(SpeechRecognition && window.speechSynthesis);
    voiceConfig.useLiveKit = voiceProvider === "livekit" && Boolean(voiceConfig.livekitReady);
    voiceConfig.useVapi = voiceProvider === "vapi" && Boolean(voiceConfig.vapiReady && isPublicHttps);
    renderVoiceProviderStatus();
    const button = $("#voice-start");
    button.disabled = voiceProvider === "livekit"
      ? !voiceConfig.livekitReady
      : !voiceConfig.useVapi && !voiceConfig.browserAvailable;
    if (voiceConfig.useLiveKit) {
      $("#voice-title").textContent = "LiveKit voice screen ready";
      $("#voice-status").textContent = "LiveKit audio · Muse interview flow · same transcript and progress";
      button.textContent = "Start voice screen";
    } else if (voiceProvider === "livekit") {
      $("#voice-title").textContent = "LiveKit setup needed";
      $("#voice-status").textContent = "Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.";
      button.textContent = "Voice unavailable";
    } else if (voiceConfig.useVapi) {
      $("#voice-title").textContent = "Voice screen ready";
      $("#voice-status").textContent = `Vapi voice · ${voiceConfig.voiceId} · Muse interview flow`;
      button.textContent = "Start voice screen";
    } else if (voiceConfig.browserAvailable) {
      $("#voice-title").textContent = "Voice screen ready";
      $("#voice-status").textContent = voiceConfig.vapiReady
        ? isLocal
          ? "Local preview uses browser speech. Deploy on public HTTPS to route calls through Vapi."
          : "Vapi needs a public HTTPS address to reach the Muse interview endpoint."
        : "Browser speech · Muse interview flow · same transcript and progress";
      button.textContent = "Start voice screen";
    } else {
      $("#voice-title").textContent = voiceConfig.vapiReady ? "Voice needs HTTPS" : "Voice setup unavailable";
      $("#voice-status").textContent = voiceConfig.vapiReady
        ? "Use a public HTTPS address for Vapi, or open this demo in a browser with speech recognition."
        : "This browser has no speech recognition. Add VAPI_PUBLIC_KEY for Vapi voice on a public HTTPS site.";
      button.textContent = "Voice unavailable";
    }
  } catch {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const browserAvailable = Boolean(SpeechRecognition && window.speechSynthesis);
    voiceConfig = { ready: false, useVapi: false, browserAvailable };
    renderVoiceProviderStatus();
    $("#voice-start").disabled = voiceProvider === "livekit" || !browserAvailable;
    $("#voice-title").textContent = voiceProvider === "livekit" ? "LiveKit settings unavailable" : browserAvailable ? "Browser voice ready" : "Voice setup unavailable";
    $("#voice-status").textContent = voiceProvider === "livekit"
      ? "LiveKit settings could not load. Check the server connection and try again."
      : browserAvailable
        ? "Vapi settings could not load. You can still preview voice with browser speech."
        : "The app could not load Vapi settings, and this browser has no speech recognition.";
    $("#voice-start").textContent = voiceProvider === "livekit" || !browserAvailable ? "Voice unavailable" : "Start voice screen";
  }
}

function collectVoiceSettings() {
  return {
    provider: $("#voice-provider").value,
    noiseCancellation: {
      enabled: $("#voice-noise-cancellation").checked,
      echoCancellation: $("#voice-echo-cancellation").checked,
      noiseSuppression: $("#voice-noise-suppression").checked,
      autoGainControl: $("#voice-auto-gain").checked,
    },
    interruption: {
      enabled: $("#voice-interruption-enabled").checked,
      mode: $("#voice-interruption-mode").value,
      minDurationMs: Number($("#voice-interruption-duration").value),
      minWords: Number($("#voice-interruption-words").value),
      backoffSeconds: Number($("#voice-interruption-backoff").value),
    },
    endpointing: {
      mode: $("#voice-endpointing-mode").value,
      minDelayMs: Number($("#voice-endpointing-min").value),
      maxDelayMs: Number($("#voice-endpointing-max").value),
    },
    preemptiveGeneration: $("#voice-preemptive").checked,
    aecWarmupMs: Number($("#voice-aec-warmup").value),
    vapi: {
      voiceId: $("#voice-voice-id").value,
    },
  };
}

function applyVoiceSettings(settings = {}, defaults = {}) {
  const current = settings;
  const fallback = defaults;
  const noise = current.noiseCancellation || {};
  const interruption = current.interruption || {};
  const endpointing = current.endpointing || {};
  const vapi = current.vapi || {};
  $("#voice-provider").value = current.provider || voiceProvider || "vapi";
  $("#voice-voice-id").value = vapi.voiceId || "Jess";
  $("#voice-noise-cancellation").checked = noise.enabled !== false;
  $("#voice-echo-cancellation").checked = noise.echoCancellation !== false;
  $("#voice-noise-suppression").checked = noise.noiseSuppression !== false;
  $("#voice-auto-gain").checked = noise.autoGainControl !== false;
  $("#voice-interruption-enabled").checked = interruption.enabled !== false;
  $("#voice-interruption-mode").value = interruption.mode || "adaptive";
  $("#voice-interruption-duration").value = interruption.minDurationMs ?? 500;
  $("#voice-interruption-words").value = interruption.minWords ?? 0;
  $("#voice-interruption-backoff").value = interruption.backoffSeconds ?? 1;
  $("#voice-endpointing-mode").value = endpointing.mode || "fixed";
  $("#voice-endpointing-min").value = endpointing.minDelayMs ?? 500;
  $("#voice-endpointing-max").value = endpointing.maxDelayMs ?? 3000;
  $("#voice-aec-warmup").value = current.aecWarmupMs ?? 3000;
  $("#voice-preemptive").checked = Boolean(current.preemptiveGeneration);

  const defaultNoise = fallback.noiseCancellation || {};
  const defaultInterruption = fallback.interruption || {};
  const defaultVapi = fallback.vapi || {};
  $("#voice-provider-default").textContent = "Default: " + labelProvider(fallback.provider || "vapi");
  $("#voice-voice-id-default").textContent = "Default: " + (defaultVapi.voiceId || "Jess");
  $("#voice-noise-default").textContent = "Default: " + (defaultNoise.enabled === false ? "off" : "all microphone processing on");
  $("#voice-interruption-mode-default").textContent = "Default: " + (defaultInterruption.mode || "adaptive");
  $("#voice-settings-badge").textContent = current.provider === fallback.provider ? "Default" : "Custom";
  $("#voice-settings-status").textContent = "Current: " + labelProvider(current.provider || "vapi") + " · " + (current.interruption?.enabled === false ? "interruptions off" : "interruptions on") + " · noise cancellation " + (current.noiseCancellation?.enabled === false ? "off" : "on");
}

function labelProvider(provider) {
  return provider === "livekit" ? "LiveKit" : "Vapi";
}

async function saveVoiceSettings({ silent = false, providedSettings = null } = {}) {
  const status = $("#voice-settings-status");
  if (!silent) status.textContent = "Applying voice settings…";
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: providedSettings || collectVoiceSettings() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Voice settings could not be saved.");
    voiceConfig = voiceConfig || {};
    voiceConfig.settings = data.voice.settings;
    voiceConfig.defaults = data.voice.defaults;
    voiceProvider = data.voice.settings.provider;
    try { localStorage.setItem("nova-voice-provider", voiceProvider); } catch {}
    applyVoiceSettings(data.voice.settings, data.voice.defaults);
    if (!silent) status.textContent = "Voice settings applied to the next voice session.";
    return data.voice.settings;
  } catch (error) {
    status.textContent = error.message || "Voice settings could not be saved.";
    return null;
  }
}

function renderVoiceProviderStatus() {
  const note = $("#voice-provider-status");
  if (!note) return;
  if (voiceProvider === "livekit") {
    note.textContent = voiceConfig?.livekitReady
      ? "LiveKit is configured on the server. The agent worker must be running; LiveKit speech services may incur usage."
      : "LiveKit needs server-side URL, API key, and API secret.";
  } else {
    note.textContent = voiceConfig?.vapiReady
      ? "Vapi is configured. On localhost, voice uses browser speech; public HTTPS uses Vapi."
      : "Vapi is not configured. On supported browsers, localhost uses browser speech.";
  }
}

async function startVoice() {
  if (!session || voiceConnected) return;
  $("#voice-start").disabled = true;
  $("#voice-title").textContent = "Connecting to Nova";
  $("#voice-status").textContent = "Allow microphone access when your browser asks.";
  try {
    if (!voiceConfig) await loadVoiceConfig();
    if (voiceProvider === "livekit") {
      await startLiveKitVoice();
      return;
    }
    if (!voiceConfig?.useVapi) {
      startBrowserVoice();
      return;
    }
    if (!VapiSdk) {
      const sdk = await import("https://esm.sh/@vapi-ai/web@2.7.1");
      VapiSdk = sdk.default;
    }

    voiceClient = new VapiSdk(voiceConfig.publicKey);
    voiceClient.on("call-start", () => {
      voiceConnected = true;
      $("#voice-title").textContent = "You’re connected";
      $("#voice-status").textContent = "Speak naturally. Nova will keep the same progress and recruiter note.";
      $("#voice-orb").classList.add("is-live");
      $("#voice-start").hidden = true;
      $("#voice-mute").hidden = false;
      $("#voice-stop").hidden = false;
      startVoicePolling();
    });
    voiceClient.on("call-end", async () => {
      voiceConnected = false;
      stopVoicePolling();
      await syncVoiceSession();
      $("#voice-title").textContent = "Voice screen ended";
      $("#voice-status").textContent = "Your conversation and progress are still here. You can continue in chat.";
      $("#voice-orb").classList.remove("is-live");
      $("#voice-start").hidden = false;
      $("#voice-start").disabled = false;
      $("#voice-start").textContent = "Start voice again";
      $("#voice-mute").hidden = true;
      $("#voice-stop").hidden = true;
      voiceClient = null;
    });
    voiceClient.on("message", (message) => {
      if (message?.type !== "transcript" || message.transcriptType !== "final") return;
      $("#voice-status").textContent = message.role === "user"
        ? "Muse is following your answer…"
        : "Nova is speaking…";
      syncVoiceSession();
    });
    voiceClient.on("error", (error) => {
      const message = error?.message || "The voice connection could not start.";
      $("#voice-title").textContent = "Voice connection issue";
      $("#voice-status").textContent = message;
      $("#voice-start").disabled = false;
    });

    const firstMessage = session.messages.length === 1 ? session.messages[0].text : "";
    const settings = voiceConfig.settings || {};
    const noise = settings.noiseCancellation || {};
    const interruption = settings.interruption || {};
    const endpointing = settings.endpointing || {};
    const vapiSettings = settings.vapi || {};
    const assistant = {
      name: "Nova recruiter",
      recordingEnabled: false,
      firstMessage,
      firstMessageMode: firstMessage ? "assistant-speaks-first" : "assistant-waits-for-user",
      firstMessageInterruptionsEnabled: Boolean(vapiSettings.firstMessageInterruptionsEnabled && interruption.enabled),
      backgroundSpeechDenoisingPlan: {
        smartDenoisingPlan: { enabled: noise.enabled !== false },
      },
      silenceTimeoutSeconds: vapiSettings.silenceTimeoutSeconds || 45,
      maxDurationSeconds: vapiSettings.maxDurationSeconds || 1200,
      startSpeakingPlan: {
        waitSeconds: endpointing.minDelayMs === undefined ? 0.4 : endpointing.minDelayMs / 1000,
      },
      stopSpeakingPlan: {
        numWords: interruption.enabled === false ? 10 : (interruption.minWords ?? 0),
        voiceSeconds: interruption.enabled === false ? 0.5 : (interruption.minDurationMs ?? 500) / 1000,
        backoffSeconds: interruption.backoffSeconds ?? 1,
      },
      clientMessages: ["transcript", "status-update", "speech-update"],
      transcriber: { provider: "deepgram", model: "nova-3", language: "en" },
      voice: { provider: "vapi", voiceId: vapiSettings.voiceId || voiceConfig.voiceId || "Jess" },
      model: {
        provider: "custom-llm",
        model: voiceConfig.model || "muse-spark-1.3-contributor",
        url: `${location.origin}/api/voice/completions?token=${encodeURIComponent(voiceConfig.sessionToken)}&roleId=${encodeURIComponent(session?.roleId || roleId)}&mode=${encodeURIComponent(session?.mode || mode)}`,
        temperature: 0.3,
        maxTokens: 260,
        messages: [{
          role: "system",
          content: voiceConfig.prompt,
        }],
      },
    };
    await voiceClient.start(assistant);
  } catch (error) {
    voiceClient = null;
    voiceConnected = false;
    $("#voice-title").textContent = "Voice could not start";
    $("#voice-status").textContent = error.message || "Check the Vapi public key and try again.";
    $("#voice-start").disabled = false;
  }
}

async function startLiveKitVoice() {
  if (!voiceConfig?.livekitReady) {
    throw new Error("LiveKit is not configured on the server. Choose Vapi or add the LiveKit server credentials.");
  }
  const response = await fetch("/api/livekit/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: session.id, sessionToken: voiceConfig.sessionToken }),
  });
  const roomConfig = await response.json();
  if (!response.ok) throw new Error(roomConfig.error || "LiveKit could not start this voice session.");

  if (!LiveKitSdk) {
    LiveKitSdk = await import("https://esm.sh/livekit-client@2.22.3");
  }
  const noise = voiceConfig.settings?.noiseCancellation || {};
  const audioCaptureDefaults = {
    echoCancellation: noise.enabled !== false && noise.echoCancellation !== false,
    noiseSuppression: noise.enabled !== false && noise.noiseSuppression !== false,
    autoGainControl: noise.enabled !== false && noise.autoGainControl !== false,
  };
  const room = new LiveKitSdk.Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults });
  livekitClient = room;
  livekitMuted = false;
  room.on(LiveKitSdk.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== "audio") return;
    const audio = track.attach();
    audio.autoplay = true;
    audio.setAttribute("aria-hidden", "true");
    document.body.append(audio);
    livekitAudioNodes.push(audio);
  });
  room.on(LiveKitSdk.RoomEvent.TrackUnsubscribed, (track) => {
    for (const element of track.detach()) {
      element.remove();
      livekitAudioNodes = livekitAudioNodes.filter((node) => node !== element);
    }
  });
  room.on(LiveKitSdk.RoomEvent.TranscriptionReceived, (segments, participant) => {
    const finalText = segments?.filter((segment) => segment.final).map((segment) => segment.text).join(" ").trim();
    if (finalText) {
      $("#voice-status").textContent = participant?.isLocal ? "Muse is following your answer…" : "Nova is speaking…";
      syncVoiceSession();
    }
  });
  room.on(LiveKitSdk.RoomEvent.ParticipantConnected, () => {
    if (livekitClient !== room) return;
    $("#voice-title").textContent = "You’re connected";
    $("#voice-status").textContent = "Speak naturally. Nova will keep the same progress and recruiter note.";
  });
  room.on(LiveKitSdk.RoomEvent.Disconnected, () => {
    if (livekitClient !== room) return;
    livekitClient = null;
    voiceConnected = false;
    stopVoicePolling();
    livekitAudioNodes.forEach((node) => node.remove());
    livekitAudioNodes = [];
    $("#voice-title").textContent = "Voice screen ended";
    $("#voice-status").textContent = "Your conversation and progress are still here. You can continue in chat.";
    $("#voice-orb").classList.remove("is-live");
    $("#voice-start").hidden = false;
    $("#voice-start").disabled = false;
    $("#voice-start").textContent = "Start voice again";
    $("#voice-mute").hidden = true;
    $("#voice-stop").hidden = true;
    syncVoiceSession();
  });

  try {
    $("#voice-status").textContent = "Connecting to the LiveKit room…";
    await room.connect(roomConfig.url, roomConfig.token);
    await room.localParticipant.setMicrophoneEnabled(true, audioCaptureDefaults);
    $("#voice-status").textContent = "Connected. Starting Nova’s interviewer…";
    const dispatchResponse = await fetch("/api/livekit/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        sessionToken: voiceConfig.sessionToken,
        roomName: roomConfig.roomName,
      }),
    });
    const dispatchResult = await dispatchResponse.json();
    if (!dispatchResponse.ok) throw new Error(dispatchResult.error || "LiveKit could not start Nova’s interviewer.");
    voiceConnected = true;
    $("#voice-title").textContent = "You’re connected";
    $("#voice-status").textContent = "Nova is joining. Speak naturally and your progress will stay in sync.";
    $("#voice-orb").classList.add("is-live");
    $("#voice-start").hidden = true;
    $("#voice-mute").hidden = false;
    $("#voice-mute").textContent = "Mute microphone";
    $("#voice-stop").hidden = false;
    startVoicePolling();
  } catch (error) {
    livekitClient = null;
    try { await room.disconnect(); } catch {}
    livekitAudioNodes.forEach((node) => node.remove());
    livekitAudioNodes = [];
    throw error;
  }
}

function startBrowserVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || !window.speechSynthesis) {
    throw new Error("This browser does not support voice mode. Try Chrome or use a Vapi-enabled HTTPS site.");
  }

  browserRecognition = new SpeechRecognition();
  browserRecognition.lang = "en-US";
  browserRecognition.continuous = false;
  browserRecognition.interimResults = true;
  browserVoiceActive = true;
  browserVoiceMuted = false;
  browserVoicePending = false;
  browserRecognition.onstart = () => {
    if (!browserVoiceActive) return;
    voiceConnected = true;
    $("#voice-title").textContent = "Listening to you";
    $("#voice-status").textContent = "Speak naturally. Nova will keep the same progress and recruiter note.";
    $("#voice-orb").classList.add("is-live");
    $("#voice-start").hidden = true;
    $("#voice-mute").hidden = false;
    $("#voice-mute").textContent = "Pause microphone";
    $("#voice-stop").hidden = false;
  };
  browserRecognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0]?.transcript || "";
      if (event.results[index].isFinal) finalText += text;
      else interimText += text;
    }
    if (interimText) $("#voice-status").textContent = `I heard: “${interimText.trim()}”`;
    const heard = finalText.trim();
    if (heard && !browserVoicePending) {
      if (heardNova(heard) || window.speechSynthesis.speaking) {
        $("#voice-status").textContent = "That was Nova. I’m listening for you.";
        return;
      }
      browserVoicePending = true;
      browserRecognition.stop();
      handleBrowserVoiceTurn(heard);
    }
  };
  browserRecognition.onerror = (event) => {
    if (!browserVoiceActive) return;
    const message = event.error === "not-allowed"
      ? "Allow microphone access in the browser to continue."
      : event.error === "network"
        ? "Browser speech recognition could not connect. Check the connection and resume."
        : event.error === "no-speech"
          ? "I didn’t hear anything. Try speaking again."
          : `Voice input issue: ${event.error || "try again"}.`;
    $("#voice-status").textContent = message;
    if (event.error === "not-allowed" || event.error === "network") browserVoiceMuted = true;
    $("#voice-mute").textContent = browserVoiceMuted ? "Resume microphone" : "Pause microphone";
  };
  browserRecognition.onend = () => {
    if (!browserVoiceActive || browserVoiceMuted || browserVoicePending) return;
    if (!window.speechSynthesis.speaking) window.setTimeout(beginBrowserRecognition, 350);
  };

  const latestAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
  if (latestAssistant?.text) speakBrowserLine(latestAssistant.text);
  else beginBrowserRecognition();
}

async function handleBrowserVoiceTurn(text) {
  $("#voice-title").textContent = "Nova is thinking";
  $("#voice-status").textContent = "Your answer is being added to the shared interview.";
  await send(text);
  const latest = session?.messages?.at(-1);
  browserVoicePending = false;
  if (browserVoiceActive && latest?.role === "assistant") speakBrowserLine(latest.text);
  else if (browserVoiceActive) beginBrowserRecognition();
}

function speakBrowserLine(text) {
  if (!browserVoiceActive || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  const voices = window.speechSynthesis.getVoices();
  const englishVoices = voices.filter((voice) => /^en(?:-|_)/i.test(voice.lang));
  const femaleVoice = englishVoices.find((voice) =>
    /\b(?:female|jenny|aria|sara|samantha|ava|zira|susan|karen|victoria|natasha|emma|jess|allison|joanna)\b|google us english|microsoft.*(?:jenny|aria|zira|sara)/i.test(voice.name)
  );
  if (femaleVoice) utterance.voice = femaleVoice;
  utterance.rate = 1.04;
  utterance.pitch = 1.08;
  utterance.onstart = () => {
    $("#voice-title").textContent = "Nova is speaking";
    $("#voice-status").textContent = "Your progress stays in sync with the conversation.";
    $("#voice-orb").classList.add("is-speaking");
  };
  utterance.onend = () => {
    $("#voice-orb").classList.remove("is-speaking");
    window.setTimeout(() => {
      if (browserVoiceActive && !browserVoiceMuted && !browserVoicePending && !window.speechSynthesis.speaking) {
        beginBrowserRecognition();
      }
    }, 700);
  };
  utterance.onerror = () => {
    $("#voice-orb").classList.remove("is-speaking");
    window.setTimeout(() => {
      if (browserVoiceActive && !browserVoiceMuted && !browserVoicePending && !window.speechSynthesis.speaking) {
        beginBrowserRecognition();
      }
    }, 700);
  };
  window.speechSynthesis.speak(utterance);
}

function heardNova(text) {
  const last = [...(session?.messages || [])].reverse().find((message) => message.role === "assistant");
  if (!last?.text) return false;
  const heard = spokenWords(text);
  const said = spokenWords(last.text);
  if (heard.length < 4 || said.length < 4) return false;
  const saidSet = new Set(said);
  const hits = heard.filter((word) => saidSet.has(word)).length;
  return hits / heard.length >= 0.72;
}

function spokenWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function beginBrowserRecognition() {
  if (!browserVoiceActive || browserVoiceMuted || browserVoicePending || !browserRecognition) return;
  try { browserRecognition.start(); } catch {}
}

async function stopVoice() {
  stopVoicePolling();
  if (browserVoiceActive) {
    browserVoiceActive = false;
    browserVoiceMuted = false;
    browserVoicePending = false;
    if (browserRecognition) {
      browserRecognition.onend = null;
      try { browserRecognition.stop(); } catch {}
    }
    browserRecognition = null;
    window.speechSynthesis?.cancel();
  }
  if (voiceClient) {
    try { await voiceClient.stop(); } catch {}
  }
  if (livekitClient) {
    const room = livekitClient;
    livekitClient = null;
    livekitMuted = false;
    try { await room.localParticipant.setMicrophoneEnabled(false); } catch {}
    try { await room.disconnect(); } catch {}
    livekitAudioNodes.forEach((node) => node.remove());
    livekitAudioNodes = [];
  }
  voiceConnected = false;
  $("#voice-orb").classList.remove("is-live");
  $("#voice-mute").hidden = true;
  $("#voice-stop").hidden = true;
  $("#voice-start").hidden = false;
  $("#voice-start").disabled = false;
  await syncVoiceSession();
}

function toggleVoiceMute() {
  if (browserVoiceActive) {
    browserVoiceMuted = !browserVoiceMuted;
    if (browserVoiceMuted) {
      try { browserRecognition?.stop(); } catch {}
      window.speechSynthesis?.cancel();
      $("#voice-status").textContent = "Microphone paused.";
      $("#voice-mute").textContent = "Resume microphone";
    } else {
      $("#voice-status").textContent = "Microphone on. Speak when ready.";
      $("#voice-mute").textContent = "Pause microphone";
      beginBrowserRecognition();
    }
    return;
  }
  if (livekitClient) {
    livekitMuted = !livekitMuted;
    livekitClient.localParticipant.setMicrophoneEnabled(!livekitMuted).catch(() => {
      livekitMuted = !livekitMuted;
      $("#voice-status").textContent = "The microphone could not be changed. Check browser permissions.";
    });
    $("#voice-mute").textContent = livekitMuted ? "Unmute microphone" : "Mute microphone";
    $("#voice-status").textContent = livekitMuted ? "Microphone muted." : "Microphone on. Speak when ready.";
    return;
  }
  if (!voiceClient) return;
  const muted = !voiceClient.isMuted();
  voiceClient.setMuted(muted);
  $("#voice-mute").textContent = muted ? "Unmute microphone" : "Mute microphone";
  $("#voice-status").textContent = muted ? "Microphone muted." : "Microphone on. Speak when ready.";
}

function startVoicePolling() {
  stopVoicePolling();
  voicePollTimer = window.setInterval(syncVoiceSession, 900);
}

function stopVoicePolling() {
  if (voicePollTimer) window.clearInterval(voicePollTimer);
  voicePollTimer = null;
}

async function syncVoiceSession() {
  if (!session) return;
  try {
    const response = await fetch(`/api/session?id=${encodeURIComponent(session.id)}`);
    if (!response.ok) return;
    session = await response.json();
    renderSession();
  } catch {}
}

async function onSend(event) {
  event.preventDefault();
  const input = $("#message");
  const text = input.value.trim();
  if (!text || !session) return;
  input.value = "";
  input.style.height = "auto";
  await send(text);
}

async function send(text) {
  setBusy(true);
  showPending(text);
  try {
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, text, session }),
    });
    if (!response.ok) throw new Error("turn failed");
    session = await response.json();
    renderSession();
    if (session.speechError) $("#llm-status").textContent = session.speechError;
  } catch {
    $("#error").hidden = false;
    renderSession();
  } finally {
    setBusy(false);
    if (conversationMode !== "voice") $("#message").focus();
  }
}

function showPending(text) {
  const log = $("#messages");
  const at = new Date().toISOString();
  log.insertAdjacentHTML("beforeend", messageMarkup({ role: "user", text, at }));
  log.insertAdjacentHTML("beforeend", messageMarkup({ role: "assistant", text: "", at, typing: true }, { isLatest: true }));
  log.scrollTop = log.scrollHeight;
  if (session) {
    syncInterviewClock({
      ...session,
      messages: [...session.messages, { role: "user", text, at }],
    });
  }
}

async function onEnd() {
  if (!session || session.done) return;
  setBusy(true);
  try {
    const response = await fetch("/api/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, session }),
    });
    session = await response.json();
    renderSession();
  } catch {
    $("#error").hidden = false;
  } finally {
    setBusy(false);
  }
}

async function loadModel() {
  const response = await fetch("/api/llm");
  if (!response.ok) return;
  renderModel(await response.json());
}

async function saveModel() {
  $("#llm-save").disabled = true;
  $("#llm-status").textContent = "Checking the key…";
  try {
    const response = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: $("#llm-key").value,
        baseUrl: $("#llm-base").value,
        model: $("#llm-model").value,
        embeddingModel: $("#llm-embed").value,
        provider: $("#llm-provider").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save that model.");
    $("#llm-key").value = "";
    renderModel(data);
  } catch (error) {
    $("#llm-status").textContent = error.message;
  } finally {
    $("#llm-save").disabled = false;
  }
}

function renderModel(data) {
  if (data.baseUrl) $("#llm-base").value = data.baseUrl;
  if (data.model) $("#llm-model").value = data.model;
  if (data.embeddingModel) $("#llm-embed").value = data.embeddingModel;
  if (data.provider) $("#llm-provider").value = data.provider;
  if (data.defaults) {
    $("#llm-provider-default").textContent = "Default: " + llmProviderLabel(data.defaults.provider);
    $("#llm-base-default").textContent = "Default: " + data.defaults.baseUrl;
    $("#llm-model-default").textContent = "Default: " + data.defaults.model;
    $("#llm-embed-default").textContent = "Default: " + data.defaults.embeddingModel;
  }
  const chatModel = data.chatModel || data.model;
  $("#model-status").textContent = data.configured ? `${chatModel} connected` : "Built-in call logic";
  $("#model-indicator").classList.toggle("is-configured", Boolean(data.configured));
  if (data.checkError) {
    $("#llm-status").textContent = data.checkError;
    return;
  }
  const retrieval = data.retrieval === "embeddings" ? "embeddings plus keywords" : "keywords";
  const other =
    data.primary === "meta"
      ? ` Gemini stays available if Meta fails.`
      : data.fallbackConfigured
        ? ` Backup: ${data.fallbackModel}.`
        : "";
  $("#llm-status").textContent = data.configured
    ? `Using ${chatModel} for chat. Retrieval is ${retrieval}.${other}`
    : "No key yet. Nova uses the built-in call logic.";
}

function llmProviderLabel(provider) {
  if (provider === "meta") return "Muse Spark";
  if (provider === "builtin") return "built-in interview controller";
  return "Gemini / OpenAI-compatible";
}

let promptTicket = 0;

async function loadPrompt(nextRole = roleId) {
  const ticket = ++promptTicket;
  const response = await fetch(`/api/prompt?roleId=${encodeURIComponent(nextRole)}`);
  if (!response.ok) return;
  const data = await response.json();
  if (ticket !== promptTicket) return;
  if ($("#prompt-role").value && data.roleId !== $("#prompt-role").value) return;
  $("#prompt").textContent = data.prompt;
  const summary = $("#prompt-summary");
  if (summary) {
    const goals = (data.goals || []).join(" · ");
    summary.hidden = false;
    summary.innerHTML = `<span class="behavior-tag">${esc(data.toneName || "Role")}</span><h3>${esc(data.roleLabel || data.roleId)}</h3><p>This prompt is for the ${esc(data.roleTitle)} role at ${esc(data.company)}. Goals: ${esc(goals)}.</p>`;
  }
  const box = $("#prompt");
  const marker = data.prompt.indexOf("Who you are calling:");
  if (marker > 0) box.scrollTop = Math.max(0, (marker / data.prompt.length) * box.scrollHeight - 24);
  else box.scrollTop = 0;
}

function renderSession() {
  if (!session) return;
  const role = roles.find((item) => item.id === session.roleId);

  const last = session.messages[session.messages.length - 1];
  const log = $("#messages");
  log.innerHTML = session.messages
    .map((message) => {
      const isLastNova = message.role !== "user" && message === last;
      const grounded =
        isLastNova && session.toolsUsed?.includes("search_knowledge")
          ? `<span class="ground">Checked the role brief</span>`
          : "";
      return messageMarkup(message, { isLatest: isLastNova, grounded });
    })
    .join("");
  log.scrollTop = log.scrollHeight;

  renderProgress(session);

  renderScore(session.score);
  renderChips(role);
  const ended = Boolean(session.done);
  const voice = conversationMode === "voice";
  $("#end").disabled = ended;
  $("#end").textContent = ended ? "Interview ended" : "End interview";
  $("#interview-closed").hidden = !ended;
  $("#chips").hidden = voice || ended;
  if (ended) {
    $("#composer").hidden = true;
    $(".composer-hint").hidden = true;
    $("#voice-dock").hidden = true;
  } else if (!voice) {
    $("#composer").hidden = false;
    $(".composer-hint").hidden = false;
    $("#voice-dock").hidden = true;
  }
  syncInterviewClock(session);
  setBusy(busy);
}

function personIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12.2a3.55 3.55 0 1 0 0-7.1 3.55 3.55 0 0 0 0 7.1Z"/><path d="M5.05 19.55c.9-3.35 3.55-5.1 6.95-5.1s6.05 1.75 6.95 5.1c.2.72-.35 1.4-1.1 1.4H6.15c-.75 0-1.3-.68-1.1-1.4Z"/></svg>`;
}

function agentIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.1 13.9 8.15 20.15 10 13.9 11.85 12 17.9 10.1 11.85 3.85 10 10.1 8.15 12 2.1Z"/><path d="m18.4 14.1.9 2.6 2.65.9-2.65.85-.9 2.6-.85-2.6-2.65-.85 2.65-.9.85-2.6Z"/></svg>`;
}

function participantAvatar(role) {
  const candidate = role === "user";
  return `<span class="message-avatar ${candidate ? "candidate-avatar" : "agent-avatar"}" aria-hidden="true">${candidate ? personIcon() : agentIcon()}</span>`;
}

function messageClock(at) {
  const date = at ? new Date(at) : new Date();
  if (Number.isNaN(date.getTime())) return { label: "", iso: "" };
  return {
    label: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    iso: date.toISOString(),
  };
}

function messageMarkup(message, { isLatest = false, grounded = "" } = {}) {
  const candidate = message.role === "user";
  const name = candidate ? INTERVIEWEE_NAME : "Nova";
  const clock = messageClock(message.at);
  const time = clock.label
    ? `<time datetime="${esc(clock.iso)}">${esc(clock.label)}</time>`
    : "";
  const body = message.typing
    ? `<span class="dots" aria-label="Nova is writing"><i></i><i></i><i></i></span>`
    : `${esc(message.text)}${grounded}`;
  const bubble = `<div class="bubble ${candidate ? "user" : "nova"}${isLatest ? " live" : ""}${message.typing ? " typing" : ""}">${body}</div>`;
  const stack = `<div class="message-stack"><div class="message-meta"><span class="who">${esc(name)}</span>${time}</div>${bubble}</div>`;
  const avatar = participantAvatar(message.role);
  return `<div class="message-row ${candidate ? "candidate-row" : "agent-row"}">${candidate ? `${stack}${avatar}` : `${avatar}${stack}`}</div>`;
}

function renderProgress(currentSession) {
  const total = currentSession.goals.length;
  const decisionTitle = currentSession.lastDecision?.title || "";
  const decisionDetail = currentSession.lastDecision?.detail || "";
  const hasCandidateTurn = currentSession.messages.some((message) => message.role === "user");
  const hasGoalEvidence = currentSession.goals.some((goal) => goal.quotes.length > 0);
  const stopped = decisionTitle === "Stopped when they said no";
  const endedEarly = decisionTitle === "Ended early";
  const completed = currentSession.phase === "done" && !stopped && !endedEarly;
  let activeStep;
  if (currentSession.phase === "done") {
    if (completed || currentSession.endedAtPhase === "close") activeStep = 2;
    else if (stopped) activeStep = hasGoalEvidence ? 1 : 0;
    else activeStep = hasCandidateTurn ? 1 : 0;
  } else {
    activeStep = currentSession.phase === "close" ? 2 : hasCandidateTurn ? 1 : 0;
  }
  const stateLabel = completed ? "Complete" : stopped ? "Stopped" : endedEarly ? "Ended early" : "In progress";
  $("#progress-copy").textContent = `${flowSteps[activeStep].title} · Step ${activeStep + 1} of ${flowSteps.length}`;
  $("#progress-state").textContent = stateLabel;
  $("#progress-state").className = `progress-state${completed ? " is-complete" : stopped || endedEarly ? " is-ended" : ""}`;
  $("#progress-steps").innerHTML = flowSteps.map((step, index) => {
    const isDone = index < activeStep || (completed && index === activeStep);
    const isCurrent = index === activeStep && !isDone;
    const isEnded = index === activeStep && (stopped || endedEarly);
    const state = isDone ? "Complete" : isEnded ? "Ended" : isCurrent ? "In progress" : "Up next";
    return `<li class="flow-step${isDone ? " is-done" : ""}${isCurrent ? " is-current" : ""}${isEnded ? " is-ended" : ""}"${isCurrent ? ' aria-current="step"' : ""}>
      <span class="flow-step-marker" aria-hidden="true">${isDone ? "✓" : index + 1}</span>
      <span class="flow-step-copy"><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></span>
      <span class="flow-step-state">${state}</span>
    </li>`;
  }).join("");

  const openedGoals = Math.min(currentSession.goalIndex + 1, total);
  $("#goal-count").textContent = `${openedGoals}/${total}`;
  $("#progress-track").setAttribute("aria-valuemax", String(total));
  $("#progress-track").setAttribute("aria-valuenow", String(openedGoals));
  $("#progress-track").setAttribute("aria-valuetext", `${openedGoals} of ${total} role goals opened`);
  $("#progress-fill").style.width = `${total ? (openedGoals / total) * 100 : 0}%`;
  $("#goals").innerHTML = currentSession.goals
    .map((goal, index) => {
      const status = goal.status;
      const opened = index < openedGoals;
      const completeGoal = index < currentSession.goalIndex || (completed && opened);
      const currentGoal = opened && index === currentSession.goalIndex && !currentSession.done;
      return `<li class="goal${opened ? " goal-opened" : ""}${currentGoal ? " goal-current" : ""}">
        <span class="goal-marker" aria-hidden="true">${completeGoal ? "✓" : index + 1}</span>
        <span class="goal-title">${esc(goal.title)}</span>
        <span class="pill ${esc(status)}">${esc(statusLabel[status] || status)}</span>
      </li>`;
    })
    .join("");
}

let timerSessionId = null;
let timerStartedAt = 0;
let timerDurationMs = 0;
let timerTick = null;

function interviewMinutes() {
  const raw = localStorage.getItem("nova-interview-minutes");
  const stored = Number(raw);
  if (raw && Number.isFinite(stored)) return Math.min(120, Math.max(1, Math.round(stored)));
  return 15;
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function paintInterviewClock(frozen) {
  const clock = $("#interview-timer");
  if (!clock || !timerStartedAt) return;
  const left = Math.max(0, timerDurationMs - (Date.now() - timerStartedAt));
  clock.textContent = left === 0 ? "Time is up" : formatClock(left);
  clock.classList.toggle("is-low", left > 0 && left <= 60000);
  clock.classList.toggle("is-done", left === 0 || frozen);
  clock.setAttribute("aria-label", left === 0 ? "Interview time is up" : `${formatClock(left)} remaining`);
}

function stopInterviewClock() {
  if (!timerTick) return;
  window.clearInterval(timerTick);
  timerTick = null;
}

function startInterviewClock() {
  if (timerTick) return;
  timerTick = window.setInterval(() => {
    const left = timerDurationMs - (Date.now() - timerStartedAt);
    paintInterviewClock(Boolean(session?.done));
    if (left <= 0 || session?.done) stopInterviewClock();
  }, 250);
}

function syncInterviewClock(current) {
  const clock = $("#interview-timer");
  if (!clock) return;
  if (timerSessionId !== current.id) {
    timerSessionId = current.id;
    timerStartedAt = 0;
    timerDurationMs = 0;
    stopInterviewClock();
  }
  const note = $("#timer-note");
  const started = current.messages.some((message) => message.role === "user");
  if (!started) {
    clock.hidden = true;
    if (note) note.hidden = false;
    clock.textContent = formatClock(interviewMinutes() * 60000);
    clock.classList.remove("is-low", "is-done");
    return;
  }
  if (note) note.hidden = true;
  if (!timerStartedAt) {
    timerStartedAt = Date.now();
    timerDurationMs = interviewMinutes() * 60000;
  }
  clock.hidden = false;
  paintInterviewClock(Boolean(current.done));
  if (!current.done && Date.now() - timerStartedAt < timerDurationMs) startInterviewClock();
  else stopInterviewClock();
}

function loadTimerSetting() {
  const input = $("#interview-minutes");
  if (!input) return;
  input.value = String(interviewMinutes());
  input.addEventListener("change", () => {
    const minutes = Math.min(120, Math.max(1, Math.round(Number(input.value) || 15)));
    input.value = String(minutes);
    localStorage.setItem("nova-interview-minutes", String(minutes));
    $("#timer-settings-status").textContent = `The next interview runs for ${minutes} minutes from the candidate's first reply.`;
  });
}

function renderScore(score) {
  const box = $("#score");
  box.hidden = false;
  if (!score) {
    box.innerHTML = liveSummary(session);
    return;
  }
  const lines = score.lines.length
    ? `<ul class="clean">${score.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
    : `<p>Nothing under the label.</p>`;
  box.innerHTML = `<p class="kicker">Interview summary</p>
    <p><span class="score-label ${esc(score.label)}">${esc(score.label)}</span></p>
    ${lines}
    <p class="muted">${esc(score.footnote)}</p>`;
}

function liveSummary(current) {
  const goals = current?.goals || [];
  const heard = goals.filter((goal) => goal.quotes?.length);
  const open = goals.filter((goal) => !goal.quotes?.length).map((goal) => goal.title);
  const lines = heard.length
    ? heard
        .map((goal) => `<li><strong>${esc(goal.title)}.</strong> ${esc(clipQuote(goal.quotes.at(-1)))}</li>`)
        .join("")
    : `<li>Nothing from the interview yet.</li>`;
  const gap = open.length ? `<p class="muted">Still open: ${esc(open.join(", "))}.</p>` : "";
  return `<p class="kicker">Interview summary</p>
    <p><span class="score-label is-open">In progress</span></p>
    <ul class="clean">${lines}</ul>
    ${gap}`;
}

function clipQuote(text) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= 22) return words.join(" ");
  return `${words.slice(0, 22).join(" ")}…`;
}

function renderChips(role) {
  const box = $("#chips");
  if (!session || session.done) {
    box.innerHTML = "";
    return;
  }
  let chips = role ? role.tryLines : [];
  if (session.phase === "close") {
    chips = [
      { label: "Say that again", text: "Can you say that again, slower?" },
      { label: "That's clear", text: "That's clear" },
    ];
  } else if (session.phase === "hold") {
    chips = [{ label: "Keep going", text: "Yes" }, ...(role ? role.tryLines : [])];
  }
  box.innerHTML = chips
    .map(
      (chip) =>
        `<button type="button" class="chip" data-text="${esc(chip.text)}" ${busy ? "disabled" : ""}>${esc(chip.label)}</button>`
    )
    .join("");
  box.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => send(button.dataset.text));
  });
}

function setBusy(value) {
  busy = value;
  $("#send").disabled = value;
  $("#message").disabled = value;
  $("#chips")?.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

const typeIcon = {
  Bug: "bug",
  "Conversation quality gap": "gap",
  "Feature request": "feature",
  "Expectation mismatch": "mismatch",
};

const rankOrder = { P0: 0, P1: 1, P2: 2 };

let lastFocus = null;

function ticketById(id) {
  return tickets.find((ticket) => ticket.id === id);
}

function icon(type) {
  const kind = typeIcon[type];
  const paths = {
    bug: `<path d="M6.2 3.1a.7.7 0 0 1 .9.2L8 4.4h1.9l.9-1.1a.7.7 0 1 1 1.1.9L11 5.4h.2a3.2 3.2 0 0 1 2.3 1.2l.9-.6a.7.7 0 1 1 .8 1.2l-.8.5c.1.4.2.8.2 1.2h1.1a.7.7 0 0 1 0 1.4H14.6c0 .4-.1.8-.2 1.2l.8.5a.7.7 0 1 1-.8 1.2l-.9-.6A3.2 3.2 0 0 1 11.2 14H6.8a3.2 3.2 0 0 1-2.3-1.2l-.9.6a.7.7 0 1 1-.8-1.2l.8-.5a3.4 3.4 0 0 1-.2-1.2H2.2a.7.7 0 0 1 0-1.4h1.2c0-.4.1-.8.2-1.2l-.8-.5a.7.7 0 1 1 .8-1.2l.9.6A3.2 3.2 0 0 1 6.8 5.4H7L6 4.2a.7.7 0 0 1 .2-1.1zM7.2 7a1.8 1.8 0 0 0-1.4 1.7v1.5A1.8 1.8 0 0 0 7.6 12h2.8a1.8 1.8 0 0 0 1.8-1.8V8.7A1.8 1.8 0 0 0 10.8 7H7.2z"/>`,
    feature: `<path d="M4 2.2h8a1 1 0 0 1 1 1V14l-5-2.4L3 14V3.2a1 1 0 0 1 1-1z"/>`,
    gap: `<path d="M2.2 3.2h8.2a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1H6.4L4.2 11.6V9.4H3.2a1 1 0 0 1-1-1V4.2a1 1 0 0 1 1-1zm6.2 7.2h3.2a1 1 0 0 1 1 1v1.6l1.4 1.2v-1.2h.6a1 1 0 0 0 1-1V7.6a1 1 0 0 0-1-1h-1.2v2.6a2 2 0 0 1-2 2H8.4z"/>`,
    mismatch: `<path d="M8 2.2 14.2 13a.8.8 0 0 1-.7 1.2H2.5a.8.8 0 0 1-.7-1.2L8 2.2zm0 3.2-.1 4.2h.2L8 5.4zm0 6.1a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z"/>`,
  };
  return `<svg class="ico ico-${kind}" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">${paths[kind]}</svg>`;
}

function renderBoard() {
  const typeSelect = $("#ticket-type");
  if (typeSelect.options.length === 1) {
    types.forEach((type) => typeSelect.add(new Option(type.name, type.id)));
  }

  const query = $("#ticket-search").value.trim().toLowerCase();
  const selectedType = typeSelect.value;
  const selectedPriority = $("#ticket-priority").value;
  const selectedScope = $("#ticket-scope").value;
  const filtered = tickets
    .filter((ticket) => selectedType === "all" || ticket.type === selectedType)
    .filter((ticket) => selectedPriority === "all" || ticket.priority === selectedPriority)
    .filter((ticket) => selectedScope === "all" || ticket.bucket === selectedScope)
    .filter((ticket) => {
      if (!query) return true;
      return [ticket.id, ticket.title, ticket.type, ticket.status, ticket.quote, ticket.issue]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => rankOrder[a.priority] - rankOrder[b.priority] || Number(a.id.slice(3)) - Number(b.id.slice(3)));

  $("#ticket-summary").innerHTML = [
    { label: "Customer notes", value: tickets.length, detail: "Across four categories" },
    { label: "In this build", value: tickets.filter((ticket) => ticket.bucket === "now").length, detail: "Included in the solution" },
    { label: "Backlog", value: tickets.filter((ticket) => ticket.bucket === "backlog").length, detail: "Needs more evidence" },
    { label: "Critical", value: tickets.filter((ticket) => ticket.priority === "P0").length, detail: "Highest impact" },
  ]
    .map((item) => `<article class="summary-card"><span>${esc(item.label)}</span><strong>${item.value}</strong><small>${esc(item.detail)}</small></article>`)
    .join("");

  $("#board").innerHTML = filtered.map(ticketRow).join("");
  $("#ticket-empty").hidden = filtered.length > 0;
  $("#ticket-count").textContent = `Showing ${filtered.length} of ${tickets.length} tickets`;
}

function ticketRow(ticket) {
  const type = types.find((item) => item.id === ticket.type);
  const scope = ticket.bucket === "now" ? "In this build" : "Backlog";
  return `<tr>
    <td class="ticket-issue" data-label="Issue">
      <span class="ticket-id">${esc(ticket.id)}</span>
      <button class="ticket-title-button" type="button" data-ticket="${esc(ticket.id)}">${esc(ticket.title)}</button>
      <span class="ticket-description">${esc(ticket.issue)}</span>
    </td>
    <td data-label="Category"><span class="ticket-category">${icon(ticket.type)}${esc(type?.name || ticket.type)}</span></td>
    <td data-label="Priority"><span class="priority-badge pri-${ticket.priority.toLowerCase()}">${esc(ticket.priority)}</span></td>
    <td data-label="Scope"><span class="scope-badge ${ticket.bucket === "now" ? "scope-now" : "scope-backlog"}">${scope}</span></td>
    <td data-label="Status"><span class="status-badge status-${ticket.status.toLowerCase()}"><span class="status-dot"></span>${esc(ticket.status)}</span></td>
    <td class="ticket-action"><button class="row-open" type="button" data-ticket="${esc(ticket.id)}" aria-label="Open ${esc(ticket.id)} details">›</button></td>
  </tr>`;
}

function renderRoadmap() {
  $("#roadmap").innerHTML = buckets.map(priorityBand).join("");
}

function priorityBand(bucket) {
  const total = tickets.filter((ticket) => ticket.bucket === bucket.id).length;
  return `
    <section class="prio-band prio-band-${bucket.id}">
      <header class="band-head">
        <h2>${esc(bucket.name)}</h2>
        <span class="count">${total}</span>
        <p class="muted">${esc(bucket.blurb)}</p>
      </header>
      <div class="prio-board">
        ${ranks.map((rank) => priorityColumn(bucket.id, rank)).join("")}
      </div>
    </section>`;
}

function priorityColumn(bucketId, rank) {
  const items = roadmapOrder[bucketId][rank].map(ticketById);
  const cards = items.length
    ? items.map(roadCard).join("")
    : `<li class="empty-slot">None</li>`;
  return `
    <section class="prio-col prio-col-${rank.toLowerCase()}" aria-label="${rank}">
      <header class="prio-head">
        <div class="prio-title">
          <h3>${rank}</h3>
          <span class="count">${items.length}</span>
        </div>
        <p class="muted">${esc(rankCopy[rank])}</p>
      </header>
      <ol class="lane-list">${cards}</ol>
    </section>`;
}

function roadCard(ticket) {
  return `
    <li>
      <button type="button" class="road" data-ticket="${ticket.id}">
        <span class="ticket-top">
          ${icon(ticket.type)}
          <span class="key">${esc(ticket.id)}</span>
          <span class="ticket-status status-${ticket.status.toLowerCase()}">${esc(ticket.status)}</span>
        </span>
        <span class="type-name">${esc(ticket.type)}</span>
        <span class="ticket-title">${esc(ticket.title)}</span>
        <span class="road-reason">${esc(ticket.why)}</span>
      </button>
    </li>`;
}

function openTicket(id) {
  const ticket = ticketById(id);
  if (!ticket) return;
  const type = types.find((item) => item.id === ticket.type);
  const bucket = buckets.find((item) => item.id === ticket.bucket);
  lastFocus = document.activeElement;
  $("#drawer-key").textContent = `${ticket.id} · ${ticket.priority}`;
  $("#drawer-title").textContent = ticket.title;
  $("#drawer-meta").textContent = `${type.name} · ${bucket.name} · ${ticket.status}`;
  $("#drawer-quote").textContent = ticket.quote;
  $("#drawer-issue").textContent = ticket.issue;
  $("#drawer-solution").textContent = ticket.solution;
  $("#drawer-why").textContent = ticket.why;
  $("#drawer").hidden = false;
  document.body.classList.add("drawer-open");
  $("#drawer-close").focus();
}

function closeTicket() {
  const drawer = $("#drawer");
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  document.body.classList.remove("drawer-open");
  if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
}

renderBoard();
renderRoadmap();
loadTimerSetting();
setAudience(audience);
