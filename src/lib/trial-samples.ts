/**
 * Example files a trial can attach in one click, in place of uploading its
 * own. The content is fixed here, so the server stores only what it already
 * holds: a trial chooses a sample by its id and sends no bytes at all.
 *
 * All fictional, and about the demo company's own suppliers, so the agreement
 * pages and their checks have something believable to work on.
 */

export type SampleFile = {
  id: string;
  label: string;
  filename: string;
  contentType: 'text/plain';
  /** The records a sample makes sense on. */
  suits: readonly string[];
  text: string;
};

const DPA = `CLOUDMERE HOSTING LIMITED (FICTIONAL)
DATA PROCESSING ADDENDUM
Sample document for trial use only. Every name in it is made up.

Parties
1. Brackenfield Home Goods Ltd (the "Controller").
2. Cloudmere Hosting Limited (the "Processor").

1. Subject matter and duration
The Processor hosts the Controller's website and order database for the
term of the Hosting Agreement and for 30 days afterwards.

2. Nature and purpose of processing
Storage, backup and retrieval of customer order records.

3. Categories of personal data and data subjects
Customers' names, delivery addresses, email addresses and order history.

4. Instructions
The Processor processes personal data only on the Controller's documented
instructions, including with regard to transfers outside the UK.

5. Confidentiality
Staff with access are bound by confidentiality.

6. Security
The Processor maintains encryption at rest and in transit, access control
and annual penetration testing.

7. Sub-processors
The Processor may engage sub-processors without prior notice. Current
sub-processors are listed on the Processor's website.

8. International transfers
Backups are replicated to a data centre in the United States. The parties
will agree an appropriate transfer mechanism in due course.

9. Personal data breaches
The Processor will notify the Controller of a personal data breach within
five working days of becoming aware of it.

10. Assistance
The Processor will assist the Controller with data subject requests at the
Processor's standard rates.

11. Deletion or return
On termination the Processor will delete the personal data within 90 days,
unless retention is required by law.

12. Audit
The Controller may audit the Processor once every three years on 60 days'
written notice.

Signed for the Controller: ____________________   Date: ________
Signed for the Processor:  ____________________   Date: ________
`;

const PEN_TEST = `PENETRATION TEST SUMMARY (FICTIONAL SAMPLE)
Brackenfield Home Goods Ltd - customer website and order API
Tested by: Ashgrove Security Testing (fictional)
Dates: three days in the last quarter

Scope
- Public website and checkout
- Order API used by the warehouse system

Findings
1. High: the order API returned full delivery addresses to any signed-in
   customer who changed the order number in the request. Fixed and re-tested.
2. Medium: session cookies did not set the SameSite attribute. Fixed.
3. Low: verbose error pages revealed the framework version. Open.

Conclusion
No high or critical findings remain open at the time of the re-test.
`;

const TRAINING = `DATA PROTECTION TRAINING RECORD (FICTIONAL SAMPLE)
Brackenfield Home Goods Ltd

Course: Handling customer data, annual refresher
Delivered: online, 40 minutes, with a short assessment

Completion by team
- Customer service: 18 of 19 completed
- Warehouse supervisors: 7 of 9 completed
- Marketing: 4 of 4 completed
- Data science: 3 of 3 completed

Outstanding staff have been reminded and are due to complete within 30 days.
`;

export const SAMPLE_FILES: readonly SampleFile[] = [
  {
    id: 'sample-dpa',
    label: 'Sample data processing addendum',
    filename: 'cloudmere-dpa-sample.txt',
    contentType: 'text/plain',
    suits: ['dpa', 'supplier', 'sharing_agreement'],
    text: DPA
  },
  {
    id: 'sample-pen-test',
    label: 'Sample penetration test summary',
    filename: 'pen-test-summary-sample.txt',
    contentType: 'text/plain',
    suits: ['supplier', 'dpa', 'policy_document', 'sharing_agreement'],
    text: PEN_TEST
  },
  {
    id: 'sample-training',
    label: 'Sample training completion record',
    filename: 'training-record-sample.txt',
    contentType: 'text/plain',
    suits: ['policy_document', 'supplier', 'sharing_agreement'],
    text: TRAINING
  }
];

export function sampleFile(id: string): SampleFile | null {
  return SAMPLE_FILES.find((s) => s.id === id) ?? null;
}

export function samplesFor(subjectType: string): SampleFile[] {
  return SAMPLE_FILES.filter((s) => s.suits.includes(subjectType));
}
