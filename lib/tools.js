import { retrieveForRole } from "./rag.js";

export const searchTool = {
  type: "function",
  function: {
    name: "search_knowledge",
    description:
      "Look up a fact in the role brief. Use this when the candidate asks about the job, the team, the place, the hours, or what happens next, and the retrieved passages do not already answer it. Pay is not in the brief. If nothing comes back, say you do not have it.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look up, in a few words.",
        },
      },
      required: ["query"],
    },
  },
};

export async function runTool(name, args, roleId) {
  if (name !== "search_knowledge") return { error: "That tool is not available." };
  const query = String(args?.query || "").slice(0, 200);
  const hits = await retrieveForRole(query, roleId, 4);
  if (!hits.length) {
    return { results: [], note: "Nothing in the brief matched. Do not invent an answer." };
  }
  return {
    results: hits.map((hit) => ({ source: hit.title, text: hit.text })),
  };
}
