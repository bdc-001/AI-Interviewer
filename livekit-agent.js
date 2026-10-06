import { cli, defineAgent, inference, ServerOptions, voice } from "@livekit/agents";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "./lib/env.js";
import { normalizeVoiceSettings } from "./lib/voice-settings.js";

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(root, ".env"));

const agentName = process.env.LIVEKIT_AGENT_NAME || "nova-interviewer";

export default defineAgent({
  entry: async (ctx) => {
    const metadata = parseMetadata(ctx.job?.metadata);
    const appUrl = String(metadata.appUrl || process.env.NOVA_APP_URL || "").replace(/\/$/, "");
    if (!appUrl || !metadata.sessionId || !metadata.sessionToken) {
      throw new Error("LiveKit dispatch is missing Nova session details.");
    }

    const settings = normalizeVoiceSettings(metadata.voiceSettings);
    const session = new voice.AgentSession({
      stt: new inference.STT({ model: settings.livekit.sttModel, language: "en" }),
      tts: new inference.TTS({
        model: settings.livekit.ttsModel,
        voice: settings.livekit.ttsVoice,
        language: "en",
        modelOptions: { speed: settings.livekit.ttsSpeed, emotion: settings.livekit.ttsEmotion },
      }),
      aecWarmupDuration: settings.aecWarmupMs,
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        endpointing: {
          mode: settings.endpointing.mode,
          minDelay: settings.endpointing.minDelayMs,
          maxDelay: settings.endpointing.maxDelayMs,
        },
        interruption: {
          enabled: settings.interruption.enabled,
          mode: settings.interruption.mode,
          minDuration: settings.interruption.minDurationMs,
          minWords: settings.interruption.minWords,
        },
        preemptiveGeneration: {
          enabled: settings.preemptiveGeneration,
          preemptiveTts: false,
        },
      },
    });

    const agent = voice.Agent.create({
      instructions: "You are Nova, a warm and energetic AI recruiter. The Nova interview controller decides every reply. Never invent, extend, or paraphrase its responses.",
      async *llmNode(_nodeContext, chatCtx) {
        const lastUserMessage = [...chatCtx.items].reverse().find(
          (item) => item.type === "message" && item.role === "user",
        );
        const text = lastUserMessage?.textContent?.trim();
        if (!text) {
          yield "I’m sorry, I missed that. Could you say it once more?";
          return;
        }

        try {
          const response = await fetch(`${appUrl}/api/livekit/turn`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${metadata.sessionToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sessionId: metadata.sessionId,
              turnId: lastUserMessage.id || `${Date.now()}-${text.slice(0, 48)}`,
              text,
            }),
            signal: AbortSignal.timeout(12000),
          });
          if (!response.ok) {
            console.error(`Nova interview controller returned HTTP ${response.status}.`);
            yield "I’m sorry, I lost my place for a moment. Could you say that again?";
            return;
          }
          const result = await response.json();
          yield result.reply || "Thanks. Let's continue with the interview.";
        } catch {
          console.error("Nova interview controller could not be reached.");
          yield "I’m sorry, I lost my place for a moment. Could you say that again?";
        }
      },
    });

    let shuttingDown = false;
    ctx.room.on("participantDisconnected", (participant) => {
      if (shuttingDown || !participant.identity?.startsWith("candidate-")) return;
      shuttingDown = true;
      session.close().finally(() => ctx.shutdown("Candidate left the LiveKit room."));
    });

    const inputOptions = {
      audioEnabled: true,
      textEnabled: true,
      videoEnabled: false,
      noiseCancellation: await optionalNoiseCancellation(settings),
    };
    await session.start({ room: ctx.room, agent, inputOptions });
    await ctx.connect();
    if (metadata.opening) await session.say(metadata.opening, { allowInterruptions: settings.interruption.enabled });
  },
});

function parseMetadata(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function optionalNoiseCancellation(settings) {
  if (!settings.noiseCancellation.enabled) return undefined;

  // The browser track always receives standard WebRTC suppression settings.
  // A deployed worker can additionally opt into LiveKit's enhanced processor
  // by installing the plugin and setting a module id in its environment.
  const moduleId = process.env.LIVEKIT_NOISE_CANCELLATION_MODULE_ID?.trim();
  if (!moduleId) return undefined;
  return {
    moduleId,
    options: {
      echoCancellation: settings.noiseCancellation.echoCancellation,
      noiseSuppression: settings.noiseCancellation.noiseSuppression,
      autoGainControl: settings.noiseCancellation.autoGainControl,
    },
  };
}

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName }));
