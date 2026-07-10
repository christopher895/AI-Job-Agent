import { MasterResume, MasterResumeSchema } from "./types";

/**
 * SOURCE OF TRUTH. Edit facts here, never in tailored output.
 *
 * TODO(chris): fill the empty contact/link fields — they directly affect scoring:
 *   - basics.github / portfolio: hiring-agent enriches its score from your GitHub.
 *   - project.link / repo: unlinked projects are penalized 30–50% by hiring-agent.
 *     Every project below currently has NO link — this is the biggest score lever.
 *   - Open-source contributions (PRs to others' repos) score the most (35 pts) and
 *     are absent here. If you have any, add them as projects labeled "open source".
 */
const master: MasterResume = {
  basics: {
    name: "Christopher Zhang",
    location: "Providence, RI",
    email: "christopher_zhang@brown.edu",
    phone: "(704) 877-1460",
    github: "https://github.com/christopherzhangbrown",
    linkedin: "",
    portfolio: "https://christopherzhang.dev",
    summary: "",
  },

  education: [
    {
      school: "Brown University",
      degrees: [
        "Sc.B. Computer Science",
        "A.B. Business Economics",
      ],
      location: "Providence, RI",
      gpa: "3.93/4.00",
      graduation: "Expected May 2028",
      coursework: [
        "Software Engineering",
        "Data Structures and Algorithms",
        "Artificial Intelligence",
        "Deep Learning",
        "Computer Systems",
        "Discrete Math",
      ],
      notes: ["Varsity Student-Athlete"],
    },
  ],

  experience: [
    {
      id: "exp-scout",
      company: "Scout Motors",
      title: "AI Engineer",
      location: "Charlotte, NC",
      start: "May 2026",
      end: "Present",
      bullets: [
        {
          id: "exp-scout-1",
          text: "Launched an AI security assistant with Copilot Studio and Jira, reducing projected support costs by $800K annually",
          tech: ["Copilot Studio", "Jira"],
          metrics: ["$800K projected annual support cost reduction"],
          tags: ["ai", "automation"],
        },
        {
          id: "exp-scout-2",
          text: "Architected an AI developer platform using MCP and LLM orchestration, cutting Scout app deployment time by 75%",
          tech: ["MCP", "LLM orchestration", "GitHub Actions"],
          metrics: ["75% deployment time reduction"],
          tags: ["ai", "platform", "devops"],
        },
        {
          id: "exp-scout-3",
          text: "Automated infrastructure provisioning using AWS EKS, Argo CD, Kargo, and Crossplane, saving ~5 hrs/week of manual DevOps work with full observability via Datadog",
          tech: ["AWS EKS", "Argo CD", "Kargo", "Crossplane", "Datadog"],
          metrics: ["~5 hrs/week of manual DevOps work saved"],
          tags: ["devops", "infrastructure", "observability"],
        },
      ],
    },
    {
      id: "exp-mandy",
      company: "Mandy",
      title: "Software Engineer",
      location: "Remote",
      start: "June 2025",
      end: "August 2025",
      bullets: [
        {
          id: "exp-mandy-1",
          text: "Built an AI-powered room redesign tool, transforming user photos into styled layouts with curated Amazon product recs",
          tech: ["AI"],
          metrics: [],
          tags: ["ai", "fullstack"],
        },
        {
          id: "exp-mandy-2",
          text: "Shipped a full-stack app for 1,000+ image uploads and layout generation using Next.js, TypeScript, IMGBB, and Vercel",
          tech: ["Next.js", "TypeScript", "IMGBB", "Vercel"],
          metrics: ["1,000+ image uploads"],
          tags: ["fullstack", "frontend"],
        },
        {
          id: "exp-mandy-3",
          text: "Integrated Clerk authentication to track preferences and deliver tailored product recommendations and chatbot responses",
          tech: ["Clerk"],
          metrics: [],
          tags: ["fullstack", "auth", "ai"],
        },
      ],
    },
    {
      id: "exp-fsab",
      company: "Full Stack @Brown",
      title: "Developer",
      location: "Providence, RI",
      start: "September 2025",
      end: "Present",
      bullets: [
        {
          id: "exp-fsab-1",
          text: "Built a production Next.js platform for the Brown Brain Bee, integrating a CMS API and implementing full-text search",
          tech: ["Next.js", "CMS API"],
          metrics: [],
          tags: ["fullstack", "frontend"],
        },
        {
          id: "exp-fsab-2",
          text: "Developing a full-stack publishing system for Brown Music Review with article management and automated email notifications",
          tech: ["Next.js"],
          metrics: [],
          tags: ["fullstack", "backend"],
        },
      ],
    },
    {
      id: "exp-waves",
      company: "Waves Swim Team",
      title: "Head Coach",
      location: "Charlotte, NC",
      start: "April 2025",
      end: "July 2025",
      bullets: [
        {
          id: "exp-waves-1",
          text: "Led and managed training for over 150 swimmers of all age levels, designing effective practice plans to maximize performance",
          tech: [],
          metrics: ["150+ swimmers"],
          tags: ["leadership"],
        },
      ],
    },
  ],

  projects: [
    {
      id: "proj-dating",
      name: "Dating Profile Analyzer",
      tech: ["React", "TypeScript", "Node.js", "Firebase", "Google Gemini API"],
      start: "October 2025",
      end: "January 2026",
      link: "",
      repo: "",
      bullets: [
        {
          id: "proj-dating-1",
          text: "Built a full-stack React and Node.js application that analyzes dating profiles using image scoring and AI-generated feedback",
          tech: ["React", "Node.js", "AI"],
          metrics: [],
          tags: ["fullstack", "ai"],
        },
        {
          id: "proj-dating-2",
          text: "Designed image-ranking algorithms using blur variance, brightness normalization, and smile detection–based weighted scoring",
          tech: [],
          metrics: [],
          tags: ["ai", "algorithms"],
        },
        {
          id: "proj-dating-3",
          text: "Implemented prompt-driven Gemini AI feedback using stored personality quiz data to generate personalized profile bio recs",
          tech: ["Google Gemini API"],
          metrics: [],
          tags: ["ai"],
        },
      ],
    },
    {
      id: "proj-travel",
      name: "Travel Planner",
      tech: ["React", "TypeScript", "Node.js", "Firebase", "OpenStreetMap API"],
      start: "September 2025",
      end: "December 2025",
      link: "",
      repo: "",
      bullets: [
        {
          id: "proj-travel-1",
          text: "Engineered an A* pathfinding system with lazy tile loading and LRU caching for 200+ mile routing across OpenStreetMap data",
          tech: ["OpenStreetMap API"],
          metrics: ["200+ mile routing"],
          tags: ["algorithms", "backend"],
        },
        {
          id: "proj-travel-2",
          text: "Architected backend routing and trip APIs with Firebase-backed persistence to save and reload multi-day itineraries in real-time",
          tech: ["Firebase", "Node.js"],
          metrics: [],
          tags: ["backend", "fullstack"],
        },
        {
          id: "proj-travel-3",
          text: "Implemented GDPR-compliant, consent-aware ad targeting, integrating external ad server APIs based on destination and itinerary",
          tech: [],
          metrics: [],
          tags: ["backend"],
        },
      ],
    },
    {
      id: "proj-swimstart",
      name: "AI Swim Start Coach",
      tech: ["React", "TypeScript", "OpenCV", "MediaPipe"],
      start: "June 2025",
      end: "June 2026",
      link: "",
      repo: "",
      bullets: [
        {
          id: "proj-swimstart-1",
          text: "Integrated MediaPipe and OpenCV for pose detection to extract joint coordinates and movement data from video input",
          tech: ["MediaPipe", "OpenCV"],
          metrics: [],
          tags: ["ai", "computer-vision"],
        },
        {
          id: "proj-swimstart-2",
          text: "Delivered AI-powered real-time feedback, helping 100+ swimmers improve their start technique with personalized insights",
          tech: ["AI"],
          metrics: ["100+ swimmers"],
          tags: ["ai"],
        },
      ],
    },
  ],

  extracurriculars: [
    {
      id: "extra-swimming",
      company: "Brown University Men's Swimming and Diving",
      title: "NCAA Division 1 Student-Athlete",
      location: "Providence, RI",
      start: "September 2024",
      end: "Present",
      bullets: [
        {
          id: "extra-swimming-1",
          text: "Balanced 25-hour training weeks, competitions, and travel while managing a full academic workload",
          tech: [],
          metrics: ["25-hour training weeks"],
          tags: ["leadership"],
        },
        {
          id: "extra-swimming-2",
          text: "Set school records in the 400 Medley and 800 Free relays; ranked top 5 all-time in 50 Free, 100 Free, 200 Free, and 100 Fly",
          tech: [],
          metrics: [],
          tags: ["achievement"],
        },
      ],
    },
    {
      id: "extra-social",
      company: "Social Media Content Creator (@chris_swimzz)",
      title: "Founder",
      location: "Remote",
      start: "April 2024",
      end: "Present",
      bullets: [
        {
          id: "extra-social-1",
          text: "Produced engaging and educational swim-related content, reaching an audience of over 28,000 followers on different platforms",
          tech: [],
          metrics: ["28,000+ followers"],
          tags: ["founder", "content"],
        },
        {
          id: "extra-social-2",
          text: "Partnered with 8+ brands, including notable names such as Nike and Arena, to create authentic promotional campaigns",
          tech: [],
          metrics: ["8+ brand partnerships"],
          tags: ["founder"],
        },
        {
          id: "extra-social-3",
          text: "Achieved over 10 million views across content, inspiring swimmers globally and fostering a supportive online community",
          tech: [],
          metrics: ["10M+ views"],
          tags: ["founder", "achievement"],
        },
      ],
    },
  ],

  skills: {
    languages: ["Java", "Python", "JavaScript", "TypeScript", "C++", "SQL"],
    frameworks: [
      "React",
      "Next.js",
      "Node.js",
      "Express.js",
      "FastAPI",
      "Flask",
      "NumPy",
      "PyTorch",
      "TensorFlow",
      "OpenCV",
      "MediaPipe",
    ],
    tools: [
      "Docker",
      "AWS EKS",
      "Kubernetes",
      "PostgreSQL",
      "Firebase",
      "Git",
      "Argo CD",
      "Kargo",
      "Crossplane",
      "Datadog",
      "Vercel",
      "Clerk",
      "Jira",
      "Copilot Studio",
      "MCP",
      "GitHub Actions",
      "REST APIs",
    ],
    interests: [
      "Piano",
      "Ping-Pong",
      "Journaling",
      "Beli",
      "Skiing",
      "Video Editing",
    ],
  },
};

/** Validated at import so a malformed edit fails fast. */
export const MASTER_RESUME: MasterResume = MasterResumeSchema.parse(master);
