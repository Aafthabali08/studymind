// Resume understanding and interview helpers. Pure and instant: every question
// quotes or names something that is actually on the candidate's resume.
import { interviewQuestions } from "../logic";
import { extractKeywords, summarizeExtractive } from "./text";

const SECTIONS = {
  summary:
    /^(summary|profile|objective|about( me)?|professional summary|career (objective|summary))$/,
  experience:
    /^((work|professional|relevant) )?(experience|employment( history)?|work history|internships?)$/,
  projects: /^((personal|academic|key|selected|major) )?projects?$/,
  education: /^(education|academic (background|details)|qualifications?)$/,
  skills:
    /^((technical|core|key|professional) )?(skills|competencies|technologies|tech stack|tools( & technologies)?)$/,
  certifications:
    /^(certifications?|courses|licen[cs]es( & certifications)?|training)$/,
  achievements:
    /^(achievements|awards|accomplishments|honou?rs|awards & achievements)$/,
};

// Common skills recognised anywhere in the resume text (case-insensitive).
const KNOWN_SKILLS = (
  "JavaScript|TypeScript|Python|Java|C\\+\\+|C#|Go|Golang|Rust|Kotlin|Swift|PHP|Ruby|Scala|R|MATLAB|SQL|NoSQL|" +
  "HTML|CSS|React|React Native|Next\\.js|Vue|Angular|Svelte|Node\\.js|Express|Django|Flask|FastAPI|Spring( Boot)?|" +
  ".NET|Laravel|Flutter|Android|iOS|GraphQL|REST( APIs?)?|gRPC|MongoDB|PostgreSQL|MySQL|SQLite|Redis|Firebase|" +
  "Supabase|DynamoDB|Elasticsearch|Kafka|RabbitMQ|AWS|Azure|GCP|Google Cloud|Docker|Kubernetes|Terraform|Jenkins|" +
  "GitHub Actions|CI/CD|Git|Linux|Bash|Nginx|Microservices|System Design|Data Structures|Algorithms|OOP|" +
  "Machine Learning|Deep Learning|NLP|Computer Vision|TensorFlow|PyTorch|Keras|scikit-learn|Pandas|NumPy|" +
  "OpenCV|LLMs?|RAG|Hugging Face|Transformers|Data Analysis|Power BI|Tableau|Excel|Spark|Hadoop|Airflow|" +
  "Figma|UI/UX|Agile|Scrum|Jira|Testing|Jest|Selenium|Cypress|Unit Testing|Blockchain|Solidity|Unity"
).split("|");
const SKILL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${KNOWN_SKILLS.join("|")})(?![\\p{L}\\p{N}+#])`,
  "giu",
);

/** Technologies and skills named in any text, in order, without repeats. */
export function techTerms(text) {
  const out = [];
  for (const m of (text || "").matchAll(SKILL_RE))
    if (!out.some((x) => x.toLocaleLowerCase() === m[1].toLocaleLowerCase()))
      out.push(m[1]);
  return out;
}

// STAR signals in everyday English ("I made the pages", "for a local shop").
export const SITUATION =
  /\b(when|while|during|at (my|our)|in (my|our) (last|previous|final|first)|project|team|client|course|internship|company|college|school|university|startup|job|shop|store|hackathon|classmates?|for (a|an|my|our) \w+)\b/i;
export const ACTION =
  /\bI\s+(?:\w+ly\s+)?(?!am\b|was\b|think\b|feel\b|guess\b|believe\b|hope\b|want\b|would\b|will\b)(?:[a-z]+ed|built|led|made|wrote|set up|ran|chose|took|found|got|began|brought|drew|taught|did|thought through|put|broke|fixed|handled|coded|designed|used|added|split|cut|sent|met|spoke|lead)\b/i;
export const RESULT =
  /(\d+(\.\d+)?\s*(%|x\b|ms|seconds|minutes|hours|days|users|people|percent|students|customers))|\b(result(ed)?|reduced|increased|improved|saved|delivered|launched|shipped|grew|cut|achieved|won|outcome|successful(ly)?|finished|completed|praised|approved|went live)\b/i;

const BULLET = /^\s*[-•*▪●◦‣○■□➢➤►✓]\s*/;
const clean = (s) => s.replace(BULLET, "").replace(/\s+/g, " ").trim();
const clip = (s, n = 90) =>
  (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s).replace(
    /[.;,]$/,
    "",
  );

/** Structure raw resume text into sections, skills, entries and metrics. */
export function parseResume(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const sections = {};
  let current = "header";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line
      .replace(/[:|_\-–—]+$/g, "")
      .trim()
      .toLocaleLowerCase();
    const key =
      heading.split(/\s+/).length <= 5 &&
      Object.keys(SECTIONS).find((k) => SECTIONS[k].test(heading));
    if (key) {
      current = key;
      sections[current] ||= [];
      continue;
    }
    (sections[current] ||= []).push(raw);
  }
  const listed = (sections.skills || [])
    .flatMap((l) =>
      clean(l)
        .replace(/^[^:]{2,30}:\s*/, "")
        .split(/\s*[,|•;·/]\s*|\s{2,}/),
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 32 && s.split(" ").length <= 4);
  const detected = [...(text || "").matchAll(SKILL_RE)].map((m) => m[1]);
  const skills = [];
  for (const s of [...listed, ...detected])
    if (!skills.some((x) => x.toLocaleLowerCase() === s.toLocaleLowerCase()))
      skills.push(s);
  const entries = (key) => {
    const out = [];
    for (const raw of sections[key] || []) {
      const line = clean(raw);
      if (!line) continue;
      if (BULLET.test(raw) && out.length) out.at(-1).points.push(line);
      else if (!BULLET.test(raw) && line.split(" ").length <= 14)
        out.push({ title: line, points: [] });
      else if (out.length) out.at(-1).points.push(line);
      else out.push({ title: clip(line, 70), points: [line] });
    }
    return out.filter((e) => /\p{L}{3}/u.test(e.title));
  };
  const all = lines.map(clean).filter(Boolean);
  const header = (sections.header || []).map(clean).filter(Boolean);
  const name = header.find(
    (l) =>
      l.split(" ").length <= 4 && !/[@\d/:|]/.test(l) && /^\p{Lu}/u.test(l),
  );
  return {
    name: name || "",
    email: (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [""])[0],
    skills: skills.slice(0, 30),
    experience: entries("experience"),
    projects: entries("projects"),
    education: (sections.education || []).map(clean).filter(Boolean),
    certifications: (sections.certifications || []).map(clean).filter(Boolean),
    achievements: (sections.achievements || []).map(clean).filter(Boolean),
    metrics: all.filter(
      (l) =>
        /\d+(\.\d+)?\s*(%|x\b|\+|k\b|users|ms\b|hours|days|students|customers|clients)/i.test(
          l,
        ) && l.split(" ").length >= 5,
    ),
    summary: summarizeExtractive([text], { sentences: 3 }).map((s) => s.text),
    keywords: extractKeywords(text, 10),
    words: all.join(" ").split(/\s+/).length,
  };
}

export function hasResumeContent(profile) {
  return Boolean(
    profile &&
    (profile.skills.length ||
      profile.projects.length ||
      profile.experience.length),
  );
}

/**
 * Resume-grounded questions. Mixes the candidate's projects, roles, measurable
 * claims and skills with role fit, ordered like a real interview.
 */
export function resumeQuestions(profile, role, experience, count = 5) {
  const name = role.trim();
  if (!name) throw new Error("Enter the role you want to practice for.");
  if (!hasResumeContent(profile))
    return interviewQuestions(role, experience).slice(0, count);
  const q = [
    `Walk me through your resume and explain how your experience leads to this ${name} role.`,
  ];
  const [p1, p2] = profile.projects;
  const [e1, e2] = profile.experience;
  const [s1, s2, s3] = profile.skills;
  const pool = [
    p1 &&
      `You worked on "${clip(p1.title, 70)}". What problem did it solve, what exactly did you build, and what was the result?`,
    e1 &&
      `In your role "${clip(e1.title, 70)}", what was the most challenging task you owned and how did you measure success?`,
    profile.metrics[0] &&
      `Your resume says: "${clip(profile.metrics[0], 120)}". How did you achieve that, and how was it measured?`,
    s1 &&
      s2 &&
      `You list ${s1} and ${s2}. Describe a situation where you used ${s1} to solve a real problem. What trade-offs did you consider?`,
    p2 &&
      `In "${clip(p2.title, 70)}", what technical decision would you change today, and why?`,
    s3 &&
      `How would you explain ${s3} to a junior teammate, and when would you not use it?`,
    e2 &&
      `What did you learn at "${clip(e2.title, 70)}" that you would bring to a ${name} team?`,
    profile.metrics[1] &&
      `Tell me more about this achievement: "${clip(profile.metrics[1], 120)}".`,
    experience === "5+ years"
      ? `As a senior ${name}, how have you guided a team through a difficult technical decision?`
      : `Which skill needed for a ${name} is not on your resume yet, and how are you building it?`,
    (profile.certifications[0] || profile.education[0]) &&
      `How has "${clip(profile.certifications[0] || profile.education[0], 80)}" prepared you for a ${name} role?`,
  ].filter(Boolean);
  for (const item of pool)
    if (q.length < count && !q.includes(item)) q.push(item);
  return q;
}

const FILLERS =
  /\b(um+|uh+|like|basically|actually|you know|kind of|sort of|literally)\b/gi;

/** Instant, transparent answer checklist (STAR structure). Not a score. */
export function reviewAnswer(answer) {
  const text = answer.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const strengths = [],
    improvements = [];
  const situation = SITUATION.test(text);
  const action = ACTION.test(text);
  const result = RESULT.test(text);
  const iCount = (text.match(/\bI\b/g) || []).length;
  const weCount = (text.match(/\bwe\b/gi) || []).length;
  const fillers = (text.match(FILLERS) || []).length;

  if (words < 40)
    improvements.push(
      `Your answer is short (${words} words). Aim for 90–200 words so you can cover context, action and result.`,
    );
  else if (words > 320)
    improvements.push(
      `Your answer is long (${words} words). Trim to the 2–3 strongest points.`,
    );
  else strengths.push(`Good length (${words} words).`);
  (situation ? strengths : improvements).push(
    situation
      ? "You set the scene with a concrete situation."
      : "Start with a concrete situation: where, when and what was at stake.",
  );
  (action ? strengths : improvements).push(
    action
      ? "You describe your own actions with strong verbs."
      : 'Say what you personally did, using action verbs ("I designed…", "I led…").',
  );
  (result ? strengths : improvements).push(
    result
      ? "You mention an outcome."
      : "Finish with a measurable result (a number, time saved, users reached, grade).",
  );
  if (weCount >= 2 && weCount > iCount)
    improvements.push(
      `You say "we" ${weCount} times and "I" ${iCount} times. Make your contribution clear.`,
    );
  if (fillers >= 3)
    improvements.push(
      `${fillers} filler words detected (like "basically", "um"). Pause instead.`,
    );
  return { words, strengths, improvements };
}
