export type EmailMessage = {
  id: string;
  from: string;      // full "Name <addr@host>" header
  fromDomain: string; // lowercased host of the sender address
  subject: string;
  snippet: string;   // Gmail's short preview
  body: string;      // best-effort plain text
  receivedAt: Date;
};

export type ClassifiedEmail = {
  isJobRelated: boolean;
  status: "applied" | "assessment" | "interviewing" | "offer" | "rejected" | "no_response" | "none";
  company: string;
  role: string;
  deadlineAt: string | null; // ISO date or null
};
