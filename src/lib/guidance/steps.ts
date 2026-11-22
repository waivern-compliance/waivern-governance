/**
 * The order to do things in, for somebody who has not done this before.
 *
 * The platform assumes a privacy professional: it names Article 30 and expects
 * you to know why that matters. Plenty of the people who have to use it are a
 * founder, an office manager, or the one engineer who drew the short straw,
 * and for them a register of processing activities is not a familiar object.
 *
 * So each step says what to do in ordinary words first, why the law cares
 * second, and how you will know it is finished third. The citation follows the
 * plain sentence rather than leading it, because somebody who needs the
 * Article number already knows to look for one, and somebody who does not is
 * put off by it.
 *
 * What this is NOT: advice on whether your processing is lawful. Every step
 * points at a decision a named person still has to make and attest to. A guide
 * that told you your basis was legitimate interests would be doing the one
 * thing this platform refuses to do.
 */

export type Stage = 'setup' | 'maintain';

/**
 * Which programme a guide is for. The privacy programme's steps are what the
 * law asks of a controller; the AI programme's are what an AI governance
 * framework asks, for an organisation that uses Govern for that alone.
 */
export type Programme = 'privacy' | 'ai';

/** The NIST AI RMF function a step serves, shown beside it under that framework. */
export type NistFunctionTag = 'GOVERN' | 'MAP' | 'MEASURE' | 'MANAGE';

export const FUNCTION_LABEL: Record<NistFunctionTag, string> = {
  GOVERN: 'Govern',
  MAP: 'Map',
  MEASURE: 'Measure',
  MANAGE: 'Manage'
};

export type Step = {
  /** Stable, because progress is looked up by it and it appears in the URL. */
  id: string;
  title: string;
  /** What to do, in words that assume no training. */
  what: string;
  /** Why it is worth doing. The citation lives at the end of this. */
  why: string;
  /** How you know you are finished. Concrete, checkable, not a feeling. */
  finishedWhen: string;
  href: string;
  /** Shown only where some entity is subject to UK law. */
  ukLaw?: true;
  /** Shown only where some entity is under UK PECR or the Irish ePrivacy Regulations. */
  eprivacy?: true;
  /** On the AI programme's steps: the NIST AI RMF function it serves. */
  fn?: NistFunctionTag;
  /** Shown only where the organisation follows the NIST AI RMF. */
  nist?: true;
  /**
   * Said when somebody is likely to get this wrong in a way that costs them
   * later. Omitted where there is nothing worth warning about — a caution on
   * every step is a caution on none.
   */
  watchOut?: string;
};

export const STAGE_LABEL: Record<Stage, string> = {
  setup: 'Setting it up',
  maintain: 'Keeping it current'
};

export const STAGE_BLURB: Record<Stage, string> = {
  setup:
    'Getting what your organisation actually does into the tool, once. Work down ' +
    'the list - each step assumes the one before it.',
  maintain:
    'The work that recurs. Nothing here is a one-off: records go stale, agreements ' +
    'lapse, and assessments come round again.'
};

export const SETUP: Step[] = [
  {
    id: 'entities',
    title: 'Say which organisations are covered',
    what:
      'Add each legal entity you are recording for. One company is one entity. If you ' +
      'have a group, a subsidiary that signs its own contracts is its own entity. For each, ' +
      'say which data protection law it is subject to: UK law, EU law, or both. Where EU law ' +
      'applies, say too whether the Irish ePrivacy Regulations do.',
    why:
      'Everything else hangs off an entity: an assessment belongs to one, a contract is ' +
      'signed by one, and a regulator asks a named company for its records. Getting this ' +
      'wrong means your reports describe nobody in particular.',
    finishedWhen:
      'At least one entity exists, its name matches what is on your contracts, and the law it is subject to is right.',
    href: '/app/admin/organisation',
    watchOut:
      'Do not create an entity per department or per product. It is a legal question, ' +
      'not an organisational chart. An entity starts as subject to UK law; one subject to EU ' +
      "law only is not asked the Data Protection Act 2018's questions."
  },
  {
    id: 'people',
    title: 'Add the people who will do the work',
    what:
      'Invite your colleagues and give each a role. Roles say what somebody may decide - ' +
      'who can approve an assessment, who can accept a risk.',
    why:
      'The tool routes work to named people. Until somebody is named, nothing is assigned ' +
      'and nothing moves. Accountability for a decision is also the point of recording it ' +
      'at all - Article 5(2) makes you responsible for demonstrating compliance, ' +
      "and a decision nobody's name is on demonstrates nothing.",
    finishedWhen:
      'Everyone who needs to approve or answer something can sign in and has a role.',
    href: '/app/admin/people',
    watchOut:
      'Whoever approves an assessment should not be the same person who wrote it. The ' +
      'tool allows it, because in a small organisation there may be nobody else - but it ' +
      'is worth knowing that is what you are doing.'
  },
  {
    id: 'templates',
    title: 'Publish the assessment templates you will use',
    what:
      'The tool ships templates for the common assessments: a short screening, a full ' +
      'DPIA, a legitimate interests assessment, a transfer assessment for each law. Publish ' +
      'the ones you need. You can read every question before you do.',
    why:
      'A template is how the same questions get asked every time, which is what makes ' +
      'twenty assessments comparable instead of twenty essays. The DPIA template follows ' +
      'the minimum content set out in Article 35(7).',
    finishedWhen: 'At least the screening and DPIA templates are published.',
    href: '/app/templates',
    watchOut:
      'Start with the shipped templates. Writing your own before you have run a single ' +
      'assessment is how you end up with questions nobody can answer.'
  },
  {
    id: 'activities',
    title: 'Write down what you actually do with personal data',
    what:
      'One entry per thing you do: running a newsletter, taking bookings, recording ' +
      'support calls. Say what data, whose, why, who else sees it, and how long you keep it.',
    why:
      'This is the record Article 30 requires, and a regulator can ask for it ' +
      'without warning. It is also the spine of everything else here - you cannot assess ' +
      'a risk in an activity you have not written down.',
    finishedWhen:
      'Every system that holds personal data appears at least once.',
    href: '/app/ropa',
    watchOut:
      'Describe what you do, not what your policy says you do. The gap between the two ' +
      'is the most common finding in an audit, and writing the policy version here hides ' +
      'it from yourself.'
  },
  {
    id: 'third-parties',
    title: 'List everyone else who touches the data',
    what:
      'Every supplier that processes personal data for you - hosting, email, analytics, ' +
      'payroll, a freelancer with a login. Record the agreement you have with each, and ' +
      'attach the signed copy.',
    why:
      'Article 28 requires a written contract with every processor, covering ' +
      'specific terms. No contract, an unsigned one and an expired one are the same ' +
      'failure. Article 28(2) also requires you to know who they subcontract to.',
    finishedWhen:
      'Every supplier has an agreement recorded, with the signed document attached.',
    href: '/app/third-parties',
    watchOut:
      'The list is nearly always longer than people expect. If a tool has a login and ' +
      'sees customer data, it belongs here, whether or not procurement knows about it.'
  },
  {
    id: 'ai',
    title: 'List the AI you use',
    what:
      'Anything that makes or supports a decision automatically, or that you built on a ' +
      'model: a chatbot, a scoring tool, a transcription service, a recommendation engine.',
    why:
      'Automated decisions with legal or similarly significant effects carry specific ' +
      'obligations: UK GDPR Articles 22A–22D, and EU GDPR Article 22. You cannot assess what ' +
      'you have not listed.',
    finishedWhen:
      'Every AI system in use appears, including ones bought as a feature of something else.',
    href: '/app/ai',
    watchOut:
      "'We do not use AI' is worth checking rather than assuming. Features inside tools " +
      'you already buy are the ones that get missed.'
  },
  {
    id: 'assessments',
    title: 'Screen each activity, and assess where screening says to',
    what:
      'Run the short screening against each processing activity. Where it says a full ' +
      'DPIA is needed, run one. Get each approved by whoever is accountable.',
    why:
      'Article 35(1) requires a DPIA where processing is likely to result in a ' +
      'high risk to people. Screening first is what tells you which those are, and ' +
      'records your reasoning for the ones you decided did not need one - which is the ' +
      'half people forget and a regulator asks about.',
    finishedWhen:
      "Every activity has been screened, and every screening that said 'DPIA' has one.",
    href: '/app/assessments',
    watchOut:
      "A screening that concludes 'no DPIA needed' is a result worth keeping, not a " +
      'wasted exercise. It is the evidence that you looked.'
  },
  {
    id: 'reviews',
    title: 'Decide when things come round again',
    what:
      'Give each approved assessment a review date. Annually is a common choice; ' +
      'something high-risk or fast-changing deserves sooner.',
    why:
      'An assessment describes what you did on the day it was written. Article 35(11) ' +
      'expects a review where the risk changes. Without a date, nothing brings it ' +
      'back to you and it quietly becomes fiction.',
    finishedWhen:
      'Every approved assessment has a review date, and the people responsible know.',
    href: '/app/reviews'
  }
];

export const MAINTAIN: Step[] = [
  {
    id: 'tasks',
    title: 'Clear what is waiting on you',
    what:
      'Your task list is the only page that shows what is actually assigned to you. ' +
      'Start there, every time.',
    why:
      'Work here is routed to named people, so an unattended task is not a reminder - it ' +
      'is a step of a process that has stopped. Overdue items are shown to administrators ' +
      'as well, because a stalled approval is an organisational problem.',
    finishedWhen: 'Nothing on your list is overdue.',
    href: '/app/tasks'
  },
  {
    id: 'due-reviews',
    title: 'Reassess what has come round',
    what:
      'When an assessment reaches its review date, read it again against what you do ' +
      'now, change what has changed, and have it re-approved.',
    why:
      'Reviewing is not a formality: the point is to catch the change nobody told you ' +
      'about. Article 35(11) expects it where risk may have changed, and in ' +
      'practice something always has.',
    finishedWhen: 'No approved assessment is past its review date.',
    href: '/app/reviews',
    watchOut:
      'Re-approving without reading it is worse than letting it lapse, because it puts a ' +
      'fresh signature on a stale claim.'
  },
  {
    id: 'expiring',
    title: 'Renew agreements before they lapse',
    what:
      'Agreements approaching their end date are flagged six months ahead. Renew, ' +
      'replace, or record that the relationship has ended.',
    why:
      'Processing under an expired contract is the same Article 28 failure as processing ' +
      'with no contract at all. Six months is renewal lead time - a warning at ninety ' +
      'days arrives after the window to renegotiate has closed.',
    finishedWhen:
      'Nothing is expiring unattended, and anything ended is archived with a reason.',
    href: '/app/third-parties'
  },
  {
    id: 'untriaged',
    title: 'Confirm the third parties something found for you',
    what:
      'A connected scanner adds suppliers it sees. Each one needs a person to say whether ' +
      'it really is a processor of yours, or a false positive.',
    why:
      'A tool can see a tracker on a page; it cannot tell whether that company processes ' +
      'personal data on your behalf. Until somebody looks, the register mixes what you ' +
      'know with what a scanner guessed.',
    finishedWhen: 'No supplier is still marked as never reviewed.',
    href: '/app/third-parties'
  },
  {
    id: 'records-current',
    title: 'Keep the record true when something changes',
    what:
      'New system, new supplier, new use of data you already hold: update the activity ' +
      'before it goes live, not at audit time.',
    why:
      'Article 30 requires the record to be current, and a record updated once a year ' +
      'describes last year. This is also the cheapest moment to notice you need a DPIA - ' +
      'before the thing is built.',
    finishedWhen: 'Nothing is running that is not written down.',
    href: '/app/ropa',
    watchOut:
      'The change that matters is rarely a new system. It is an existing system being ' +
      'used for something new.'
  },
  {
    id: 'risks',
    title: 'Treat or accept the risks you have found',
    what:
      'A risk sits open until somebody either does something about it or accepts it in ' +
      'writing, with a reason and a date.',
    why:
      'An open risk nobody decided on is not a decision - it is a gap with a number ' +
      "beside it. Accepting a risk is a legitimate answer, but it has to be somebody's " +
      'name and reasoning, which is what makes it defensible later.',
    finishedWhen:
      'Every open risk has either a mitigation in progress or a recorded acceptance.',
    href: '/app/risks'
  },
  {
    id: 'breach',
    title: 'Know what happens if there is a breach',
    what:
      'Read this before you need it. A personal data breach is recorded here, and the ' +
      'tool runs the statutory clock from the moment you became aware.',
    why:
      'Article 33 gives you 72 hours from awareness to notify the supervisory authority where ' +
      'the breach is likely to result in a risk to people. Article 34 is a separate ' +
      'question about telling the people affected. Seventy-two hours is not long to be ' +
      'learning where the button is. Where both laws apply, each authority is told: the ' +
      'Information Commission, and the EU authority or authorities concerned.',
    finishedWhen:
      'You know where the breach page is, and who would be told first.',
    href: '/app/breaches',
    watchOut:
      'The clock starts when you become aware, not when you finish investigating. ' +
      'Record it early and update it as you learn more.'
  },
  {
    id: 'requests',
    title: 'Know what to do when somebody asks for their data',
    what:
      'Read this before the first one arrives. When a person asks for a copy of their data, ' +
      'asks you to delete it or objects to how you use it, it is recorded here and the tool ' +
      'counts the month you have to answer.',
    why:
      'Article 12(3) gives you one calendar month from receipt to respond to a request ' +
      'under Articles 15 to 22, extendable by two more only if you say why within the first ' +
      'month. A request can arrive by any route, to anybody, without naming the law.',
    finishedWhen:
      'You know where requests are recorded, and who in your team handles them.',
    href: '/app/requests',
    watchOut:
      'The month starts when the request arrives, wherever it lands - not when it reaches you. ' +
      'An objection to direct marketing must always be upheld.'
  },
  {
    id: 'complaints',
    ukLaw: true,
    title: 'Know what to do when somebody complains about their data',
    what:
      'Read this before the first one arrives. When a person complains to you about how their ' +
      'personal data has been handled, it is recorded here, the tool counts the 30 days to ' +
      'acknowledge it, and each enquiry and update is kept.',
    why:
      'Since 19 June 2026, section 164A of the Data Protection Act 2018 requires you to make ' +
      'complaining easy, acknowledge each complaint within 30 days, look into it, keep the person ' +
      'informed and tell them the outcome without undue delay.',
    finishedWhen:
      'You know where complaints are recorded, and who in your team handles them.',
    href: '/app/complaints',
    watchOut:
      'A complaint need not use the word, and can arrive inside a reply to a request. The 30 days ' +
      'run from when it arrived, wherever it landed.'
  },
  {
    id: 'cookies',
    eprivacy: true,
    title: 'Know what your websites store, and why',
    what:
      'Add each website and app, upload a Waivern Consent Analyser report for it, and record the basis ' +
      'every cookie and similar item relies on.',
    why:
      "UK PECR regulation 6 restricts storing anything on a person's device. Since 5 February 2026, " +
      'Schedule A1 lets statistics and appearance cookies go without consent - but only where people ' +
      'are told about them and can object simply and for free. Everything else needs consent or must ' +
      'be strictly necessary. The Irish ePrivacy Regulations (S.I. 336/2011, regulation 5) have no ' +
      'such exceptions; Govern records which law each site is under, but checks the Irish rules only ' +
      'in a later release.',
    finishedWhen: 'Every item in use on every site has a basis with no gaps.',
    href: '/app/cookies',
    watchOut:
      "A scanner's category is a guess. Analytics shared with an advertiser is not statistics under " +
      'Schedule A1, however the cookie is named.'
  },
  {
    id: 'marketing',
    eprivacy: true,
    title: 'Know what your marketing relies on',
    what:
      'Add each newsletter, promotional email or text campaign and call programme, link it to its ROPA entry, and ' +
      'record the PECR basis it relies on.',
    why:
      'PECR regulations 21 and 22 decide who may be emailed, texted or called for marketing, on top of the UK GDPR. ' +
      'The soft opt-in and, since February 2026, the charity soft opt-in each come with conditions you must be able ' +
      'to show; call lists must be screened against the TPS. The Irish ePrivacy Regulations (S.I. 336/2011, ' +
      'regulation 13) differ; Govern records which law each activity is under, but checks the Irish rules ' +
      'only in a later release.',
    finishedWhen: 'Every running activity has a basis with no gaps.',
    href: '/app/marketing',
    watchOut:
      "An objection to direct marketing is absolute. Once it is upheld, only the person's fresh consent lets you " +
      'market to them again.'
  },
  {
    id: 'evidence',
    title: 'Take an export when you need to show your work',
    what:
      'Export the registers and the audit trail. Do it before an audit, a funding round, ' +
      "or a customer's security review - not during.",
    why:
      'Article 5(2) puts the burden on you to demonstrate compliance, not on a regulator ' +
      'to disprove it. The audit trail here is hash-linked, so an export can be shown as ' +
      'evidence rather than asserted as a summary.',
    finishedWhen: 'You have taken an export and know what is in it.',
    href: '/app/exports'
  }
];

export const STEPS: Record<Stage, Step[]> = {
  setup: SETUP,
  maintain: MAINTAIN
};

/**
 * The guide for an organisation using Govern for AI governance alone: no
 * entity under UK or EU data protection law, so nothing here asks for a
 * processing record, a DPIA or a statutory clock. Ordered as the NIST AI RMF
 * is - Govern first, because the other three functions assume it - and each
 * reason names the subcategory it serves, after the plain sentence.
 */
export const AI_SETUP: Step[] = [
  {
    id: 'ai-entities',
    fn: 'GOVERN',
    title: 'Say which organisations are covered',
    what:
      'Add each legal entity whose AI you are governing. One company is one entity. For each, ' +
      'say whether UK or EU data protection law applies to it. A company established in neither, ' +
      'that does not sell to or monitor people there, is subject to neither.',
    why:
      'Every AI system, assessment and risk belongs to an entity, which is how a customer, an ' +
      'insurer or a regulator is shown the record of the company they deal with. Saying which ' +
      'law applies is also what keeps questions you do not have to answer off your screens.',
    finishedWhen:
      'At least one entity exists, its name matches your contracts, and the law it is under is right.',
    href: '/app/admin/organisation',
    watchOut:
      'UK and EU data protection law can reach a company outside both that offers goods or ' +
      'services to people there, or monitors them. Check before you record neither.'
  },
  {
    id: 'ai-people',
    fn: 'GOVERN',
    title: 'Name who is accountable for AI',
    what:
      'Invite your colleagues and give each a role. Name an AI governance lead, and the people ' +
      'who approve an assessment or accept a risk.',
    why:
      'Work is routed to named people, so until somebody is named nothing moves. Clear roles and ' +
      'lines of accountability for mapping, measuring and managing AI risk are what the NIST AI ' +
      'RMF asks for first (GOVERN 2.1).',
    finishedWhen:
      'Everyone who needs to approve or answer something can sign in and has a role.',
    href: '/app/admin/people',
    watchOut:
      'Whoever approves an assessment should not be the person who wrote it. The tool allows ' +
      'it, because a small team may have nobody else, but it is worth knowing you are doing it.'
  },
  {
    id: 'ai-appetite',
    fn: 'GOVERN',
    title: 'Say how much AI risk you will accept',
    what:
      'Write down, for each kind of AI risk, how much the organisation is prepared to live with, ' +
      'and have it signed off. Risks above it then show as outside appetite.',
    why:
      'Without a stated tolerance every risk decision is made afresh by whoever is in the room. ' +
      'Documenting it is GOVERN 1.3 and MAP 1.5 of the NIST AI RMF.',
    finishedWhen: 'At least one appetite statement has been approved.',
    href: '/app/risks/appetite'
  },
  {
    id: 'ai-templates',
    fn: 'GOVERN',
    title: 'Publish the AI assessment you will use',
    what:
      'The tool ships an AI risk assessment and a short intake form for proposals. Publish them, ' +
      'reading every question first, so each system is asked the same things.',
    why:
      'The same questions every time are what make twenty assessments comparable rather than ' +
      'twenty essays, and a repeatable process is what GOVERN 1.4 asks for.',
    finishedWhen: 'An AI risk assessment template is published.',
    href: '/app/templates',
    watchOut:
      'Start with the shipped template. Rewriting it before you have run one assessment is how ' +
      'you end up with questions nobody can answer.'
  },
  {
    id: 'ai-register',
    fn: 'MAP',
    title: 'List the AI you use',
    what:
      'One entry per system: a chatbot, a scoring tool, a transcription service, a model you ' +
      'built, and AI features inside software you already buy. Say what it is for, who owns it ' +
      'and what stage it is at.',
    why:
      'You cannot assess what you have not listed. An inventory of AI systems is GOVERN 1.6, and ' +
      'knowing what each is for and who it affects is the whole of MAP 1.',
    finishedWhen:
      'Every AI system in use appears, including ones bought as a feature of something else.',
    href: '/app/ai',
    watchOut:
      "'We do not use AI' is worth checking rather than assuming. Features inside tools you " +
      'already buy are the ones that get missed.'
  },
  {
    id: 'ai-suppliers',
    fn: 'MAP',
    title: 'Name the supplier behind each bought-in system',
    what:
      'Add each AI supplier to the third-party register if it is not there yet. Then open each ' +
      "bought-in system and choose its supplier under Keep it current, so the supplier's contract " +
      'and its own assessment sit beside the system.',
    why:
      "A bought-in system is only as well governed as its supplier's data use, testing and " +
      'terms. The NIST AI RMF puts third-party risk inside yours (GOVERN 6.1, MAP 4.1) and asks ' +
      'you to keep watching it (MANAGE 3.1), which starts with knowing who the supplier is.',
    finishedWhen: 'No bought-in system is missing its supplier.',
    href: '/app/ai?gap=supplier_unrecorded',
    watchOut:
      'The vendor typed when a system was added is only a note. Until the supplier is chosen ' +
      'from the third-party register, the system counts as having none.'
  },
  {
    id: 'ai-assessments',
    fn: 'MEASURE',
    title: 'Assess each system, and have it approved',
    what:
      'Run the AI risk assessment on each system, starting with what is live or makes decisions ' +
      'about people. Have each approved by somebody other than the person who wrote it.',
    why:
      'An assessment is where the risks are named, rated and tested against your appetite: the ' +
      'trustworthiness characteristics of MEASURE 2, and the go-live gate the register enforces.',
    finishedWhen: 'Every system on the register has an approved AI assessment.',
    href: '/app/ai',
    watchOut:
      'A system can be assessed and still be unmonitored. The register flags that separately.'
  },
  {
    id: 'ai-profile',
    fn: 'MANAGE',
    nist: true,
    title: 'Say where you stand on the framework, and where you aim to be',
    what:
      'Go through the NIST AI RMF profile and, for each outcome, say how far you meet it now and ' +
      'how far you mean to. Govern shows the evidence it already holds beside each one.',
    why:
      'A current and a target profile is how the NIST AI RMF expects an organisation to describe ' +
      'its own use of the framework, and the gap between them is your plan.',
    finishedWhen: 'At least one target is set in each function.',
    href: '/app/ai/profile',
    watchOut:
      'Not applicable is an answer worth giving, with a reason. Leaving an outcome blank says ' +
      'nobody looked.'
  }
];

export const AI_MAINTAIN: Step[] = [
  {
    ...MAINTAIN.find((s) => s.id === 'tasks')!,
    fn: 'GOVERN'
  },
  {
    id: 'ai-intake',
    fn: 'MAP',
    title: 'Catch new AI before it is built or bought',
    what:
      'Point people at the intake form when they want to use AI for something new. Each proposal ' +
      'is triaged, and the ones that go ahead join the register.',
    why:
      'The cheapest moment to shape a system is before it exists. Deciding whether to proceed is ' +
      'MAP 1.1 and MANAGE 1.1 of the NIST AI RMF.',
    finishedWhen: 'Nothing on the intake list is waiting for a decision.',
    href: '/app/ai/intake'
  },
  {
    id: 'ai-changes',
    fn: 'MAP',
    title: 'Keep the register true when a system changes',
    what:
      'A new model, new data or a new use is recorded on the system before it goes live. The ' +
      'register then asks for the assessment to be looked at again.',
    why:
      'An assessment describes the system on the day it was written. Tracking changes is what ' +
      'keeps it describing the system you run (MANAGE 4.1).',
    finishedWhen: 'Nothing is running that the register does not describe.',
    href: '/app/ai',
    watchOut:
      'The change that matters is rarely a new system. It is an existing one being used for ' +
      'something new, or a supplier changing the model underneath you.'
  },
  {
    id: 'ai-testing',
    fn: 'MEASURE',
    title: 'Test what is live, and keep the results',
    what:
      'Record each test of a live system - accuracy, bias, robustness - with who ran it and ' +
      'what it found. Independent testing counts for more on the systems that decide things.',
    why:
      'Evidence that a system still behaves as assessed is what MEASURE 2 and MANAGE 4.1 ask for, ' +
      'and the register flags a live system nobody has tested.',
    finishedWhen:
      'No live system is flagged as never tested or failing its last test.',
    href: '/app/ai'
  },
  {
    ...MAINTAIN.find((s) => s.id === 'risks')!,
    fn: 'MANAGE'
  },
  {
    id: 'ai-incidents',
    fn: 'MANAGE',
    title: 'Know what happens when AI causes harm',
    what:
      'Read this before you need it. Harm, a challenged outcome or a concern about an AI system ' +
      'is reported here, goes to a named person, and what was done about it is kept.',
    why:
      'Incidents tracked, responded to and communicated, including to the people affected, are ' +
      'MANAGE 4.3 of the NIST AI RMF.',
    finishedWhen:
      'Nothing reported is still open without somebody working on it.',
    href: '/app/ai/incidents',
    watchOut:
      'A concern can be raised in confidence. Only the person handling it, and those allowed to ' +
      'see confidential concerns, see who raised it.'
  },
  {
    id: 'ai-reviews',
    fn: 'MANAGE',
    title: 'Reassess what has come round',
    what:
      'When an assessment reaches its review date, read it again against the system as it runs ' +
      'now, change what has changed, and have it re-approved.',
    why:
      'Periodic review of how risk is managed is GOVERN 1.5, and a system past its review date ' +
      'cannot go further live through the register.',
    finishedWhen: 'No approved assessment is past its review date.',
    href: '/app/reviews',
    watchOut:
      'Re-approving without reading it is worse than letting it lapse, because it puts a fresh ' +
      'signature on a stale claim.'
  },
  {
    id: 'ai-evidence',
    fn: 'GOVERN',
    title: 'Take an export when you need to show your work',
    what:
      'Export the register, the profile and the audit trail before a customer questionnaire, an ' +
      'insurer or a board asks, not during.',
    why:
      'The audit trail here is hash-linked, so an export can be shown as evidence rather than ' +
      'asserted as a summary. Documentation others can rely on is GOVERN 4.2.',
    finishedWhen: 'You have taken an export and know what is in it.',
    href: '/app/exports'
  }
];

export const AI_STEPS: Record<Stage, Step[]> = {
  setup: AI_SETUP,
  maintain: AI_MAINTAIN
};

export const PROGRAMME_STEPS: Record<Programme, Record<Stage, Step[]>> = {
  privacy: STEPS,
  ai: AI_STEPS
};
