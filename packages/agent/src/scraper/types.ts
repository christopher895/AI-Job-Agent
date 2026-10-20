export interface JobListing {
  title: string;
  company: string;
  location: string;
  url: string;
  /**
   * Season tags from a repo feed that publishes them (SimplifyJobs: "Summer 2027").
   * Undefined when the feed has no `terms` array, and for company-board postings.
   */
  terms?: string[];
  /**
   * Season word from feeds that tag by season without a year (vanshb03:
   * "Summer", "Spring/Summer"); the repo itself names the year.
   */
  season?: string;
}
