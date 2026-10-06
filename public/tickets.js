const types = [
  { id: "Bug", name: "Bugs" },
  { id: "Conversation quality gap", name: "Conversation quality gaps" },
  { id: "Feature request", name: "Feature requests" },
  { id: "Expectation mismatch", name: "Expectation mismatches" },
];

const buckets = [
  {
    id: "now",
    name: "Now",
    blurb: "Solving in this prototype.",
  },
  {
    id: "backlog",
    name: "Backlog",
    blurb: "Not in this build.",
  },
];

const ranks = ["P0", "P1", "P2"];

const rankCopy = {
  P0: "Broken call, or the business result.",
  P1: "The rest of the screen a human would run.",
  P2: "Ships with that work, or waits.",
};

const roadmapOrder = {
  now: {
    P0: ["NV-4", "NV-2"],
    P1: ["NV-9", "NV-8", "NV-7", "NV-3"],
    P2: ["NV-1", "NV-6", "NV-11", "NV-12"],
  },
  backlog: {
    P0: ["NV-10"],
    P1: [],
    P2: ["NV-5"],
  },
};

const tickets = [
  {
    id: "NV-1",
    type: "Conversation quality gap",
    bucket: "now",
    priority: "P2",
    status: "Solving",
    title: "Restaurant screens sound scripted",
    quote:
      "Candidates keep saying the AI sounds like it's reading a script when we screen for the restaurant manager roles. Feels robotic, not like a real conversation.",
    issue:
      "Frontline screens use the same wording no matter what the person just said. A restaurant manager can hear the list. They don't open up, so the note has nothing a hiring manager can use.",
    solution:
      "The restaurant screen uses a warmer, plainer tone. Nova picks up one real detail and asks one next question. The goals stay in order, and they are not read out as a list.",
    why: "Frontline candidates hear the script first. The voice change ships with the listening fix. It is not what is dropping people off the call.",
  },
  {
    id: "NV-2",
    type: "Conversation quality gap",
    bucket: "now",
    priority: "P0",
    status: "Solving",
    title: "Vague technical answers get a pass",
    quote:
      "Our engineering screens are going fine but I noticed Nova doesn't push back when a candidate gives a vague answer to a technical question. It just moves to the next question.",
    issue:
      "\"I do backend and stuff\" is treated as done. The next question fires. A recruiter never hears what that person actually changed.",
    solution:
      "A vague work answer stays on the same goal. Nova uses their words and asks once for one real case. If they say they don't know, Nova asks whether the question is unclear instead of repeating the goal. A second general answer moves on.",
    why: "This is the main fix in the prototype. A vague answer currently counts as finished, so an engineer screen can look fine and still have nothing in it.",
  },
  {
    id: "NV-3",
    type: "Feature request",
    bucket: "now",
    priority: "P1",
    status: "Solving",
    title: "Follow-ups from what they just said",
    quote:
      "Can Nova ask follow-up questions based on what the candidate just said, instead of just going down a fixed list?",
    issue:
      "They asked for a feature. The underlying hole is the same as the vague answers and the missed projects. The next line is already written before they speak.",
    solution:
      "The controller chooses the kind of turn from the last answer. The model phrases that turn from the role, the current goal, and what they just said. One follow-up, then the next goal.",
    why: "This is the same behavior as the vague answers and the missed projects. It is solved by that work, so it does not get its own project.",
  },
  {
    id: "NV-4",
    type: "Bug",
    bucket: "now",
    priority: "P0",
    status: "Solving",
    title: "Three questions, then a hangup",
    quote:
      "We had a candidate hang up mid-call for a tutor role screen. When we checked the transcript, Nova had asked 3 questions back to back without giving them room to actually finish talking.",
    issue:
      "The turn was taken too early. Three questions landed before the person finished. They hung up. That is a broken turn, not a missing feature.",
    solution:
      "If the sentence isn't finished, say you're here and ask nothing. Never put the remaining goals into one turn, even when the answer is short.",
    why: "A candidate hung up. This is the only note that lost a person in the middle of the call, so it is first in the prototype.",
  },
  {
    id: "NV-5",
    type: "Expectation mismatch",
    bucket: "backlog",
    priority: "P2",
    status: "Backlog",
    title: "Strong hires came back Medium",
    quote:
      "Love the product overall, huge time save. One thing, the confidence score for two candidates who I later hired myself both came back 'medium' when honestly they were clearly strong. Not sure what's driving that score.",
    issue:
      "They read Medium as \"not strong\". It may have meant \"the screen didn't hear enough\". Two people they later hired are not enough to call the model wrong.",
    solution:
      "Don't move High, Medium, and Low in this exercise. Show what was heard, so Medium can be read as a thin screen. Recalibrate only when we have hire outcomes, not from two stories.",
    why: "Two later hires are not enough to move High, Medium, and Low. It stays in the backlog until we have outcomes. The lines under the score are the P2 that ships now.",
  },
  {
    id: "NV-6",
    type: "Feature request",
    bucket: "now",
    priority: "P2",
    status: "Solving",
    title: "One voice for every role",
    quote:
      "Is there a way to have Nova sound different for different roles? Like, more formal for engineering, more warm for the tutor and frontline stuff. Right now it sounds the same for everything.",
    issue:
      "Engineering and a tutor screen use the same voice. Formal candidates get cheer, or a tutor gets a stiff script. Either way it sounds recorded.",
    solution:
      "Tone is part of the role. Engineering stays short and uses their technical words. Restaurant and tutor screens stay warm and plain. Each turn still has one question.",
    why: "Formal for engineering, warmer for frontline. It ships with the voice change. It is not what is losing people.",
  },
  {
    id: "NV-7",
    type: "Conversation quality gap",
    bucket: "now",
    priority: "P1",
    status: "Solving",
    title: "The AI line gets rushed",
    quote:
      "A candidate complained they weren't told upfront this was an AI, not a human. We do have the consent line at the start but I think it's getting glossed over too fast in the call.",
    issue:
      "The disclosure exists. It shares a breath with the first question, so people miss that this is not a person.",
    solution:
      "The opening says Nova is an AI recruiter, names Harbor and the role, says they can stop, and asks the first role question in that same turn.",
    why: "Candidates missed that this was an AI. The disclosure sits in the opening with the first question, so it is heard and the screen starts. A separate yes check turned into a loop, so this build does not add one.",
  },
  {
    id: "NV-8",
    type: "Feature request",
    bucket: "now",
    priority: "P1",
    status: "Solving",
    title: "Candidate questions kill the call",
    quote:
      "We need Nova to handle candidates who ask questions back, like 'what's the salary range' or 'what's the team like.' Right now it just says it can't answer that and moves on, which feels weird and kills the vibe.",
    issue:
      "A fair question gets \"I can't answer that\", and the next screen question is already in the same turn. The conversation drops.",
    solution:
      "Team, place, and hours come from that role's brief. Nova can search the brief when the answer is not already in the turn. Pay is absent, so Nova says it does not have the number and will not guess, then asks if they want to keep going. The next goal waits.",
    why: "A fair question ends the call. The fix is the same turn rule as the rest of this build, so it is in Now.",
  },
  {
    id: "NV-9",
    type: "Conversation quality gap",
    bucket: "now",
    priority: "P1",
    status: "Solving",
    title: "Named projects get no follow-up",
    quote:
      "For engineering candidates, when they mention a specific technology or project, Nova doesn't dig into it at all. Feels like a missed opportunity, a human recruiter would always ask more.",
    issue:
      "They handed over the interesting part, a tool or a project, and Nova walked past it to the next line on the list.",
    solution:
      "If they name a technology, a number, or a project, ask one question about that. If they already gave a reason and a result, don't dig just to show you can.",
    why: "One dig when they name a real project. Same build as the vague-answer fix. The screen did not drop the person, so it sits under the hangup and the vague pass.",
  },
  {
    id: "NV-10",
    type: "Conversation quality gap",
    bucket: "backlog",
    priority: "P0",
    status: "Blocked",
    title: "Engineer screens convert worse",
    quote:
      "Our restaurant manager screens are converting well, but our software engineer screens have a much lower pass-to-next-round rate than when our human recruiters used to do first screens. Not sure if it's the questions or the conversation itself.",
    issue:
      "This is an outcome, not a cause. It might be the questions, the conversation, or the score. The tag on this ticket is a guess. Filing it as a conversation gap is the leading hunch, not a finding.",
    solution:
      "Don't ship a new question set or nudge the cutoff yet. Read the engineer screens next to the old human ones. Tag each miss: a thin answer Nova accepted, a question humans always ask, or a score that doesn't match the note. Then change one of those. Not all three.",
    why: "This is the result that hits the business, and it is not in the prototype. The note does not say the cause. It stays blocked in the backlog until those calls are read.",
  },
  {
    id: "NV-11",
    type: "Conversation quality gap",
    bucket: "now",
    priority: "P2",
    status: "Solving",
    title: "Next steps are too fast",
    quote:
      "Small thing, but the AI's voice pace feels too fast when it's explaining next steps at the end of the call. A couple candidates asked us to repeat what happens next because they didn't catch it.",
    issue:
      "The close is one rushed paragraph. People leave without knowing what happens next, and they have to ask the recruiter to say it again.",
    solution:
      "The close is short sentences, one idea each, with an offer to repeat those same facts. If they end the interview, Nova says it has ended and they can leave. The recruiter summary is kept off that line.",
    why: "The close is too fast. Same pacing rule as consent, and the harm is smaller, so it is P2 inside this build.",
  },
  {
    id: "NV-12",
    type: "Feature request",
    bucket: "now",
    priority: "P2",
    status: "Solving",
    title: "Score with no reason",
    quote:
      "Can we get a summary sent to us not just as a score, but as 2-3 lines on why the candidate got that score? Right now we just see 'Medium confidence' and nothing else.",
    issue:
      "The recruiter sees one word. They can't tell a thin answer from a strong person the screen barely heard.",
    solution:
      "When the screen ends, the recruiter view shows High, Medium, or Low plus two or three lines from what was said. The candidate sees that the interview has ended and they can leave. The score is not spoken.",
    why: "Two or three lines under the score. The screen already keeps the quotes, so this ships now. It does not move the High, Medium, and Low lines.",
  },
];
