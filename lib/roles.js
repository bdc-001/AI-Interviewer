// Role cards for the screen. Tone, goals, and the knowledge base are the
// inputs the voicebot would put on a call: conversation goal, traits, and
// knowledge_base. Pay is absent on purpose.

export const roles = {
  engineer: {
    id: "engineer",
    label: "Software engineer",
    family: "engineering",
    company: "Harbor",
    roleTitle: "software engineer",
    candidate: "the candidate",
    toneName: "Formal",
    toneGuide:
      "Formal and plain. Short sentences. Use the technical words they use, and do not simplify a term they already used correctly. Do not perform warmth. Do not say awesome, love that, or great answer. Sound like a calm recruiter who has done a lot of these calls.",
    hookPatterns: [
      /\b(React|Node|Python|Java|Kafka|Kubernetes|Postgres|PostgreSQL|Redis|gRPC|GraphQL|AWS|Docker|TypeScript|Rust|Django|Spring|SQL|Terraform|GCP|Azure|Ruby|Rails|Elasticsearch|Spark|Airflow|Flink|Next\.js|Golang)\b/gi,
      /\bGo\b/g,
      /\bp\d{2}\b/gi,
      /\b\d[\d,]*(?:\.\d+)?\s*(?:ms|milliseconds|seconds|%|percent)?\b/gi,
    ],
    goals: [
      {
        id: "owned",
        title: "Work they owned",
        aim: "One system they personally changed, and what happened after.",
        ask: "Tell me about a piece of work you owned recently. What did it do, and what was your part?",
        shortAsk: "Back to that piece of work you owned. What did you personally change?",
      },
      {
        id: "judgment",
        title: "A fuzzy problem",
        aim: "What they did when the requirements were unclear, before they committed to a solution.",
        ask: "Tell me about a time the requirements were fuzzy. What did you do before you committed to a solution?",
        shortAsk: "Back to a time the requirements were fuzzy. What did you do first?",
      },
      {
        id: "tradeoff",
        title: "A tradeoff",
        aim: "A real constraint, and what they gave up.",
        ask: "Tell me about a tradeoff you actually made on a project. What did you give up?",
        shortAsk: "Back to a tradeoff you made. What did you give up?",
      },
    ],
    knowledge: {
      role: "You would join the payments team as a software engineer. The work is backend services, reviews, and the on-call rotation.",
      team: "Payments is seven people. Six engineers and one product manager.",
      place: "Hybrid. Two days a week in the main office.",
      hours: "Normal product hours, plus on-call about one week in six.",
      next: "A recruiter reads the note from this screen. If they want to continue, they write to you. Nova does not book that, and does not have a date.",
    },
    tryLines: [
      { label: "Vague answer", text: "I mostly do backend, APIs and stuff." },
      {
        label: "Specific project",
        text: "I rebuilt checkout in Go because the Python service timed out under sale traffic. p99 went from 800ms to 180. I owned the service.",
      },
      { label: "Name a tool only", text: "I worked on Kafka." },
      { label: "Ask about pay", text: "What's the salary range?" },
      { label: "Stop mid sentence", text: "So I started the migration and" },
      { label: "Off topic", text: "The weather is nice. I watched a movie last night." },
    ],
  },

  restaurant: {
    id: "restaurant",
    label: "Restaurant manager",
    family: "frontline",
    company: "Harbor",
    roleTitle: "restaurant manager",
    candidate: "the candidate",
    toneName: "Warm",
    toneGuide:
      "Warm and plain. Short sentences. Everyday words. Do not say stakeholder, deliver, leverage, or circle back. It is fine to sound glad they picked up. Do not get cute, and do not pile on compliments.",
    hookPatterns: [
      /\b(Saturday|Sunday|Friday|lunch|dinner|expo|walk-in|walk ins|rush|host stand|patio)\b/gi,
      /\b\d[\d,]*(?:\.\d+)?(?:\s*(?:minute|minutes|min|hour|hours))?(?:\s+wait)?\b/gi,
      /\b(?:two|three|four|five|six)\s+(?:cooks|servers|hours|tables|people)\b/gi,
    ],
    goals: [
      {
        id: "service",
        title: "A busy service",
        aim: "One real shift, and what they did when it got hard.",
        ask: "Tell me about a busy service you ran. What did that shift actually look like?",
        shortAsk: "Back to a busy service you ran. What was happening on the floor?",
      },
      {
        id: "people",
        title: "A hard moment with a person",
        aim: "A guest or a staff problem, and what they did in the moment.",
        ask: "Tell me about a hard moment with a guest or someone on staff. What did you do?",
        shortAsk: "Back to that hard moment with a person. What did you do?",
      },
      {
        id: "next-day",
        title: "Setting up the next day",
        aim: "How they leave a shift so the next one is not a surprise.",
        ask: "How do you leave a shift so the next day is not a mess?",
        shortAsk: "Back to how you leave a shift. What do you actually check?",
      },
    ],
    knowledge: {
      role: "You would manage one Harbor location. The floor during service, the schedule, and the close.",
      team: "About eighteen hourly people, plus one assistant manager.",
      place: "The downtown location. The job is on site.",
      hours: "Service hours, including nights, and one weekend day.",
      next: "Someone from the store calls if they want you to come in and see the floor. Nova does not set that visit.",
    },
    tryLines: [
      { label: "Vague answer", text: "Yeah I manage shifts, it's pretty busy." },
      {
        label: "A real Saturday",
        text: "Saturday dinner we had a 40 minute wait and two cooks called out.",
      },
      { label: "What they did", text: "I pulled one server onto expo and cut the menu down to the grill." },
      { label: "Ask about the team", text: "What's the team like?" },
    ],
  },

  tutor: {
    id: "tutor",
    label: "Math tutor",
    family: "frontline",
    company: "Harbor",
    roleTitle: "math tutor",
    candidate: "the candidate",
    toneName: "Warm",
    toneGuide:
      "Warm and plain. Short sentences. Talk like a person, not a curriculum. Do not say pedagogy, stakeholder, or learning outcomes unless they say it first. Glad they picked up is enough. No cheerleading.",
    hookPatterns: [
      /\b(fractions?|algebra|geometry|homework|chocolate bar|times tables|long division)\b/gi,
      /\b(?:\w+th grader|middle school|high school)\b/gi,
      /\b\d[\d,]*(?:\.\d+)?\s*(?:weeks|week|days|students|kids)?\b/gi,
      /\b(?:two|three|four|five|six)\s+(?:weeks|days|students|kids)\b/gi,
    ],
    goals: [
      {
        id: "stuck",
        title: "A student who is stuck",
        aim: "How they start when a student does not get it.",
        ask: "When a student does not get a topic, how do you start?",
        shortAsk: "Back to a student who is stuck. How do you start?",
      },
      {
        id: "slow",
        title: "Someone who took a while",
        aim: "One student who did not get it quickly, and what the tutor changed.",
        ask: "Tell me about a student who took a while to get something. What did you change?",
        shortAsk: "Back to a student who took a while. What did you change?",
      },
      {
        id: "clicked",
        title: "How they know it clicked",
        aim: "A concrete sign the student understood, not a feeling.",
        ask: "How can you tell the idea actually clicked, rather than they nodded?",
        shortAsk: "Back to how you can tell it clicked. What do you look for?",
      },
    ],
    knowledge: {
      role: "You would tutor math, mostly middle school and early high school, one student at a time.",
      team: "You work with the student. A coordinator sets the schedule and is the person you call when something is off.",
      place: "Sessions are online.",
      hours: "After school, a few evenings. The coordinator matches the times.",
      next: "The coordinator writes if they want a short sample session. Nova does not schedule it.",
    },
    tryLines: [
      { label: "Vague answer", text: "I explain things until they get it." },
      {
        label: "A real student",
        text: "A seventh grader was stuck on fractions for three weeks.",
      },
      {
        label: "What they did",
        text: "I had him split a chocolate bar, then we wrote the same cut as numbers.",
      },
      { label: "Are you a person?", text: "Are you a real person?" },
    ],
  },
};

export function getRole(roleId) {
  return roles[roleId] || roles.engineer;
}

export function listRoles() {
  return Object.values(roles);
}

export function publicRoles() {
  return listRoles().map((role) => ({
    id: role.id,
    label: role.label,
    family: role.family,
    toneName: role.toneName,
    tryLines: role.tryLines,
    goals: role.goals.map((goal) => ({ id: goal.id, title: goal.title })),
  }));
}
