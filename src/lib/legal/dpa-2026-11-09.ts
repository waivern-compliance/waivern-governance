/**
 * The Data Processing Agreement for Waivern's hosted service, version of 9
 * November 2026, exactly as accepted. Never edit a published version: a change
 * is a new version, which every entity accepts afresh (see `documents.ts`).
 */
export const DPA_2026_11_09 = `
This Data Processing Agreement (**Agreement**) governs the processing of personal data carried out by Waivern Limited (the **Processor**) on behalf of its customer (the **Controller**) in connection with the Controller's use of Waivern Limited's products and services, including the Waivern Governance Tool. It is incorporated into the parties' Main Agreement and requires no separate signature.

## 1. Definitions

In this Agreement, the following terms have the meanings set out below. Capitalised terms not defined here have the meanings given to them in the Main Agreement.

**Agreement** means this Data Processing Agreement, including all Annexes, as incorporated into and forming part of the Main Agreement.

**Main Agreement** means the commercial or services agreement between the Controller and Waivern Limited governing the Controller's use of Waivern Limited's products and services, including any order form, subscription agreement or click-through acceptance by which the Controller has agreed to be bound by Waivern Limited's terms. For the Governance Tool Service, it includes the Governance Tool Terms.

**Controller** has the meaning given to it in the Data Protection Laws, and in the context of this Agreement means the customer of Waivern Limited that determines the purposes and means of the processing of Personal Data described herein.

**Processor** has the meaning given to it in the Data Protection Laws, and in the context of this Agreement means Waivern Limited (company number 16375372, registered address 14 Eastbury Road, Petts Wood, Orpington, England, BR5 1JW), which processes Personal Data on behalf of the Controller.

**Sub-Processor** means any third party engaged by the Processor to carry out Processing of Personal Data on behalf of the Controller.

**Personal Data** has the meaning given to it in the Data Protection Laws.

**Processing** (and **Process**, **Processed**) has the meaning given to it in the Data Protection Laws.

**Data Subject** has the meaning given to it in the Data Protection Laws.

**Data Protection Laws** means the UK General Data Protection Regulation (as it forms part of the law of England and Wales, Scotland and Northern Ireland by virtue of section 3 of the European Union (Withdrawal) Act 2018) (**UK GDPR**) and the Data Protection Act 2018 (**DPA 2018**), together with any subordinate legislation, guidance or codes of practice issued by the Information Commission (formerly the Information Commissioner's Office), in each case as amended (including by the Data (Use and Access) Act 2025), replaced or superseded from time to time.

**Personal Data Breach** has the meaning given to it in the Data Protection Laws, namely a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, Personal Data transmitted, stored or otherwise processed.

**Services** means the products and services provided by the Processor to the Controller under the Main Agreement, as further described therein, including the Governance Tool Service.

**Sub-Processor List** means the separate document maintained and published by the Processor that sets out the current authorised Sub-Processors engaged by the Processor in connection with the Services, as referenced in clause 6.1 of this Agreement.

**Governance Tool Service** means the Waivern Governance Tool as hosted by the Processor: the free, shared hosted service, and any dedicated instance the Processor hosts for the Controller under a Main Agreement.

**Governance Tool Terms** means the Waivern Governance Tool Terms of Service, as updated from time to time.

**Controller Third-Party Service** means a service that the Controller chooses to connect to the Governance Tool Service and contracts for directly. Examples are an AI model provider configured for the assistant, and a system linked through the integration API.

**Public Request Form** means a form the Controller publishes through the Governance Tool Service so that individuals can make data protection requests or complaints to the Controller.

**Contributor Link** means a link the Controller issues through the Governance Tool Service that lets a person without an account contribute to one assessment.

## 2. Incorporation and Effect

2.1 This Agreement is incorporated into and forms part of the Main Agreement between the Controller and the Processor governing the Controller's use of the Services.

2.2 By entering into, signing, or otherwise accepting the Main Agreement, the Controller and the Processor agree to be bound by this Agreement. A separate signature to this Agreement is not required: execution or acceptance of the Main Agreement constitutes execution of this Agreement by the same parties, with effect from the effective date of the Main Agreement.

2.3 The parties to this Agreement are the parties identified in the Main Agreement. Where the Main Agreement is accepted by signature, order form, click-through or other online acceptance, that same acceptance binds the accepting parties to this Agreement to the same extent and by the same means.

## 3. Subject Matter, Roles and Duration

3.1 The Processor shall Process Personal Data solely for the purpose of providing the Services to the Controller under the Main Agreement, and shall not Process Personal Data for any other purpose except as required by law.

3.2 As between the parties, the Controller is the controller and the Processor is the processor in respect of the Processing described in this Agreement and in Annex 1.

3.3 This Agreement shall take effect on the effective date of the Main Agreement and shall continue for the duration of the Processing carried out by the Processor in connection with the Services, unless terminated earlier in accordance with this Agreement or the Main Agreement.

3.4 **The Processor's own data.** The Processor is a controller, not a processor, of the limited Personal Data it needs to run its Services. That includes account and sign-in details, requests to set up an organisation, feedback, emails to the Processor's own operators, and security and access logs. That Processing is outside this Agreement and is described in the Processor's Privacy Notice.

3.5 **Law enforcement processing.** This Agreement does not cover Processing for law enforcement purposes by a competent authority under Part 3 of the DPA 2018. Under the Governance Tool Terms, competent authorities may not use the free, shared Governance Tool Service. Where the Processor hosts a dedicated instance for a competent authority, its Main Agreement must contain terms meeting section 59 of the DPA 2018.

## 4. Details of the Processing

The subject matter, duration, nature, purpose, categories of Personal Data and categories of Data Subjects in respect of the Processing carried out under this Agreement are set out in Annex 1. Where Annex 1 references the Record of Processing Activity (GDPR Article 30), that document forms the authoritative basis for the processing particulars and is incorporated by reference.

The Processing carried out under this Agreement arises from the Controller's use of the Services, which comprise:

- **compliance readiness services**: tooling combining automated evidence gathering from codebases, cloud infrastructure and policy documents with expert review and guidance (Annex 1, Part A); and
- **the Governance Tool Service**: a hosted application in which the Controller keeps its records of processing, assessments, risks, data protection requests, complaints, breaches and AI systems, routes decisions about them to named people, and keeps an audit trail of those decisions (Annex 1, Part B).

In providing the Services, the Processor may Process Personal Data included in materials submitted by the Controller or its authorised users. For the Governance Tool Service, this also includes Personal Data entered by people the Controller invites through Contributor Links and by individuals using the Controller's Public Request Forms.

## 5. Processor's Obligations

The Processor SHALL comply with the following obligations in respect of all Personal Data Processed under this Agreement:

**(a) Instructions.** The Processor SHALL Process Personal Data only on the documented instructions of the Controller, including with regard to transfers of Personal Data to a third country or an international organisation, unless Processing is required by applicable law to which the Processor is subject. Where the Processor is required by law to Process Personal Data otherwise than in accordance with the Controller's instructions, the Processor SHALL inform the Controller of that legal requirement before Processing, unless the law prohibits such disclosure on important grounds of public interest. The Main Agreement, this Agreement, and the way the Controller configures and uses the Services, together form the Controller's documented instructions. For the Governance Tool Service, that use includes publishing a Public Request Form, issuing a Contributor Link or connecting a Controller Third-Party Service.

**(b) Confidentiality.** The Processor SHALL ensure that persons authorised to Process the Personal Data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.

**(c) Security.** The Processor SHALL implement and maintain appropriate technical and organisational measures to ensure a level of security appropriate to the risk, in accordance with Article 32 of the UK GDPR. The Processor's technical and organisational measures are described in Annex 2, which references the Processor's Information Security Policy and the ISO27001 ISMS Statement of Applicability rather than reproducing those measures in full. Those documents do not currently cover the Governance Tool Service. For it, the measures are those set out in Annex 2, Part B. The Processor SHALL not materially reduce the overall level of security maintained during the term of the Main Agreement.

**(d) Sub-Processors.** The Processor SHALL respect the conditions for engaging Sub-Processors set out in clause 6 of this Agreement.

**(e) Data Subject rights.** Taking into account the nature of the Processing, the Processor SHALL assist the Controller, by appropriate technical and organisational measures insofar as this is possible, to fulfil the Controller's obligation to respond to requests for exercising Data Subjects' rights under Chapter III of the UK GDPR (including rights of access, rectification, erasure, restriction, portability and objection). For the Governance Tool Service, the Controller can find, export, correct and delete most records itself. The audit trail is the exception: its entries cannot be edited or deleted while the Controller's organisation exists, so a correction is recorded as a new entry.

**(f) Controller's compliance obligations.** The Processor SHALL assist the Controller in ensuring compliance with the obligations under Articles 32 to 36 of the UK GDPR, taking into account the nature of the Processing and the information available to the Processor. This includes assisting with:

- the implementation and maintenance of appropriate security measures (Article 32);
- notification of a Personal Data Breach to the supervisory authority (Article 33);
- communication of a Personal Data Breach to affected Data Subjects (Article 34); and
- data protection impact assessments and prior consultation (Articles 35 and 36).

**(g) Breach notification.** The Processor SHALL notify the Controller without undue delay, and in any event within seventy-two (72) hours of becoming aware of a Personal Data Breach affecting Personal Data Processed under this Agreement. Such notification SHALL include, to the extent then known:

- a description of the nature of the Personal Data Breach including, where possible, the categories and approximate number of Data Subjects concerned and the categories and approximate number of Personal Data records concerned;
- the name and contact details of the Processor's data protection contact;
- a description of the likely consequences of the Personal Data Breach; and
- a description of the measures taken or proposed to be taken to address the Personal Data Breach, including, where appropriate, measures to mitigate its possible adverse effects.

Where it is not possible to provide all of the above information at the time of initial notification, the information may be provided in phases without undue further delay.

**(h) Return or deletion.** At the choice of the Controller, the Processor SHALL, following termination or expiry of the Main Agreement, delete or return to the Controller all Personal Data Processed under this Agreement, and shall delete existing copies of that Personal Data, unless storage of the Personal Data is required by applicable law. The Controller SHALL notify the Processor of its election to require return or deletion. The Processor SHALL confirm in writing when deletion has been completed. For the Governance Tool Service:

- return is by the Controller exporting its data with the Service's export functions. Exports are available throughout the notice period when the Processor ends the Service. After any other ending, they are available for 14 days where lawful and practical;
- the Processor SHALL delete the Controller's Personal Data, including its audit trail, from the live service within 30 days after the Service ends for the Controller; and
- copies in backups are overwritten in the normal backup cycle, within a further 27 days.

**(i) Audit and information.** The Processor SHALL make available to the Controller all information necessary to demonstrate compliance with the obligations set out in Article 28 of the UK GDPR, and SHALL allow for and contribute to audits, including inspections, conducted by the Controller or an auditor mandated by the Controller. The Processor SHALL inform the Controller immediately if, in its opinion, an instruction infringes the Data Protection Laws. Audits shall be conducted with reasonable prior written notice, no more than once per calendar year except where there are reasonable grounds to suspect non-compliance, at the Controller's cost, and subject to appropriate confidentiality obligations. For the shared Governance Tool Service, the Processor will first answer an audit request with documents, such as its Security page, the Governance Tool's public source code and test results and its hosting provider's security reports. Any inspection SHALL be limited so that it does not expose other customers' data or weaken the security of the shared service.

## 6. Sub-Processors

6.1 **General authorisation.** The Controller grants the Processor general written authorisation to engage Sub-Processors to Process Personal Data in connection with the Services. The Sub-Processors currently engaged by the Processor are set out in the Sub-Processor List, a separate document which is incorporated into and referenced by this Agreement and which the Processor updates from time to time in accordance with this clause 6.

6.2 **Flow-down.** The Processor SHALL impose on each Sub-Processor, by written contract, data protection obligations equivalent to those set out in this Agreement, and SHALL remain fully liable to the Controller for the performance of each Sub-Processor's obligations under that contract.

6.3 **Prior notice of changes.** The Processor SHALL inform the Controller in advance, and in any event before the change takes effect, of any intended addition or replacement of a Sub-Processor, so as to give the Controller the opportunity to object to the change. Such notice may be given by updating the Sub-Processor List and notifying the Controller, or by such other written means as the parties agree. For the Governance Tool Service, notice is sent by email to the owners of the Controller's organisation.

6.4 **Right to object and terminate.** If the Controller objects to an intended addition or replacement of a Sub-Processor, the Controller MAY terminate this Agreement and the Main Agreement, without penalty for the act of termination, by giving written notice within thirty (30) days of the Processor's communication of the change. If the Controller does not exercise this right within that thirty (30) day period, the change is deemed accepted and the new or replacement Sub-Processor may be engaged.

6.5 **Controller Third-Party Services are not Sub-Processors.** The Controller engages a Controller Third-Party Service itself, under its own contract, and that provider is not the Processor's Sub-Processor. When the Controller connects one, it instructs the Processor to send it the data that the Controller's configuration calls for. For the AI assistant, that is the text users send to it, after the Governance Tool Service has removed common identifiers such as email addresses and phone numbers. The Controller is responsible for its contract with that provider, including any Article 28 terms and transfer safeguards. The Processor supplies no AI model and no fallback model.

6.6 **Sign-in.** Users sign in to the Governance Tool Service with their own Google accounts. Google acts as the user's identity provider: it confirms who the user is and passes the Processor their name and email address. **[Confirm with solicitor: on that basis, Google is not engaged by the Processor to Process the Controller's Personal Data, and so is not a Sub-Processor.]**

## 7. International Transfers

7.1 The Processor SHALL not transfer Personal Data outside the United Kingdom unless such transfer is made in compliance with an appropriate safeguard or transfer mechanism under the UK GDPR, including:

- a transfer approved by regulations under Article 45A of the UK GDPR, including adequacy regulations made under section 17A of the DPA 2018 that continue to have effect;
- the International Data Transfer Agreement (IDTA) issued by the Information Commissioner;
- the UK Addendum to the European Commission's Standard Contractual Clauses; or
- an applicable derogation under Article 49 of the UK GDPR.

7.2 The Processor SHALL carry out international transfers of Personal Data only in accordance with the Controller's instructions. The transfer mechanisms relied upon in respect of each Sub-Processor are set out in the Sub-Processor List. Transfer particulars are further documented in the Record of Processing Activity (GDPR Article 30) and the Transfer Risk Assessment. This Agreement does not restate those particulars.

7.3 Where a transfer mechanism relied upon by the Processor or a Sub-Processor ceases to be valid or is otherwise unavailable, the Processor SHALL notify the Controller without undue delay and take all reasonable steps to ensure that an alternative appropriate safeguard is put in place before any further transfer is made.

7.4 **Where the Governance Tool Service is hosted.** The shared Governance Tool Service is hosted in Railway's EU West (Amsterdam) region, so storing Personal Data in it is a transfer from the UK to the EEA. That transfer relies on the UK's approval of transfers to the EEA. By using the shared service, the Controller instructs the Processor to hold its Personal Data there. Any access from outside the EEA, for example by the hosting provider's support staff, relies on the mechanism shown for that provider in the Sub-Processor List. A dedicated instance may be hosted in the UK or another region agreed in its Main Agreement.

## 8. Controller's Obligations

8.1 The Controller warrants and represents that:

- it has a lawful basis under the Data Protection Laws for each category of Processing it instructs the Processor to carry out;
- its instructions to the Processor comply with the Data Protection Laws; and
- it has provided all required notices to, and obtained all required consents from, Data Subjects in connection with the Personal Data it submits to the Processor for Processing.

8.2 The Controller is responsible for the accuracy, quality and legality of any Personal Data it provides to the Processor, and for the means by which it acquired that Personal Data.

8.3 **Governance Tool Service.** When using the Governance Tool Service, the Controller SHALL:

- give individuals who use its Public Request Forms, or contribute through its Contributor Links, the privacy information the Data Protection Laws require;
- keep no more Personal Data in the Service's registers than their purpose needs;
- not enter Personal Data into the AI assistant, and remain responsible for anything it sends to a Controller Third-Party Service;
- keep its own exports of anything it needs, as the Processor does not restore one organisation's data alone; and
- not use the free, shared Governance Tool Service if it is a competent authority under Part 3 of the DPA 2018.

## 9. Liability, Term and General

9.1 **Liability.** The liability of each party under or in connection with this Agreement is governed by the provisions of the Main Agreement. Nothing in this Agreement shall be read as creating any liability cap or exclusion that does not exist under the Main Agreement. Where the Main Agreement does not address a particular head of liability arising under this Agreement, the parties' liability shall be determined in accordance with the applicable law. For the Governance Tool Service, the limits and exclusions of liability in the Governance Tool Terms apply to this Agreement.

9.2 **Term.** This Agreement takes effect on the effective date of the Main Agreement and continues for the duration of the Processing carried out by the Processor in connection with the Services. Obligations that by their nature survive termination (including obligations regarding the return or deletion of Personal Data and the maintenance of confidentiality) shall continue to apply after termination or expiry of the Main Agreement.

9.3 **Order of precedence.** In the event of any conflict or inconsistency between this Agreement and the Main Agreement on matters concerning the protection, Processing or security of Personal Data, this Agreement shall prevail. For all other matters, the Main Agreement shall prevail.

9.4 **Governing law and jurisdiction.** The governing law and jurisdiction applicable to this Agreement are those specified in the Main Agreement.

9.5 **Entire agreement.** This Agreement, together with the Main Agreement and the documents referenced herein, constitutes the entire agreement between the parties in respect of the Processing of Personal Data carried out by the Processor on behalf of the Controller, and supersedes all prior agreements, representations and understandings on that subject matter.

9.6 **Severability.** If any provision of this Agreement is held to be invalid, unlawful or unenforceable, the remaining provisions shall continue in full force and effect.

9.7 **Amendments.** Any amendment to this Agreement must be agreed in writing by both parties, save that the Processor may update the Sub-Processor List in accordance with clause 6 without further formality. For the free, shared Governance Tool Service, the Processor may also amend this Agreement by giving at least 30 days' notice in the way the Governance Tool Terms allow for changes to those terms. No such amendment may remove a protection that Article 28(3) of the UK GDPR requires.

## Annex 1 - Details of the Processing

The following tables set out the processing particulars for the purposes of Article 28(3) of the UK GDPR. Part A covers the compliance readiness services and Part B covers the Governance Tool Service. Where a particular is not established in the available evidence, a placeholder is provided for the parties to complete.

### Part A - Compliance readiness services

| Field | Detail |
| --- | --- |
| Subject matter | The Processing of Personal Data by the Processor in the course of providing its compliance readiness tooling and associated services to the Controller under the Main Agreement. |
| Duration | For the duration of the Main Agreement and any post-termination period during which the Processor retains Personal Data pending return or deletion in accordance with clause 5(h). |
| Nature and purpose of Processing | Automated and manual analysis of materials submitted by the Controller (including policy documents, codebase artefacts and cloud infrastructure evidence) for the purpose of generating compliance assessments, recommendations and audit-ready documentation. The Processor processes Personal Data only to the extent that it is included in materials submitted by the Controller or its authorised users. |
| Categories of Personal Data | The categories of Personal Data Processed are determined by the Controller and may include: names and contact details of the Controller's staff and authorised users; personal data included in policy documents, risk registers or other compliance materials submitted by the Controller; personal data of the Controller's own data subjects to the extent included in submitted materials. The Controller is responsible for ensuring that only Personal Data necessary for the Services is submitted. Full processing particulars are maintained in the Record of Processing Activity (GDPR Article 30). |
| Categories of Data Subjects | The Controller's staff and authorised users; data subjects whose Personal Data is included in materials submitted by the Controller to the Services. |

### Part B - Governance Tool Service

| Field | Detail |
| --- | --- |
| Subject matter | Hosting the records the Controller keeps in the Governance Tool Service, and running the Service's workflows on them. |
| Duration | For as long as the Controller uses the Governance Tool Service. Then for the export period and the deletion periods in clause 5(h): up to 30 days in the live service and a further 27 days in backups. |
| Nature of Processing | Storage, retrieval, organisation, display, export and deletion. Also: daily backups kept for 27 days; virus scanning of uploaded files; routing tasks and decisions to named users; an append-only, hash-chained audit trail; taking in requests and complaints through Public Request Forms; contributions through Contributor Links; exchanging records with other systems through the integration API at the Controller's instruction; and relaying assistant conversations to the Controller's chosen AI provider. |
| Purpose of Processing | To let the Controller keep and evidence its data protection and AI governance records and decisions. |
| Categories of Personal Data | Names, work email addresses, roles and activity of the Controller's users. The names and contact details of contributors. For data protection requests and complaints: the requester's or complainant's name, any representative's name, contact details, relationship to the Controller, and what they wrote. For breaches, incidents and risks: details of affected individuals that the Controller chooses to record. Personal Data in files the Controller uploads, such as signed agreements, and in free-text fields. Assistant conversations. Public Request Form internet addresses, held only as a keyed hash. The Service is built to hold decisions about processing rather than the personal data being processed, and the Controller decides what it enters. |
| Special category and criminal offence data | Not required by the Service. It may be present where the Controller records it, for example in a request, complaint or breach record. The Controller is responsible for it under clause 8.3. Part 3 law enforcement processing is excluded (clause 3.5). |
| Categories of Data Subjects | The Controller's staff and other Authorised Users; contributors invited through Contributor Links; individuals who make requests or complaints to the Controller, and their representatives; individuals affected by breaches or other matters the Controller records; contacts at the Controller's suppliers and other third parties. |
| Retention within the Service | Records stay until the Controller deletes them or the Service ends. Audit trail entries are kept for as long as the organisation exists. Assistant conversations are deleted after 30 days. Hashed Public Request Form internet addresses are deleted after one day. Backups are kept for 27 days. |
| Location | Railway, EU West (Amsterdam) region, for the shared service. For a dedicated instance, the region agreed in its Main Agreement. |

The authoritative and current processing particulars are maintained in the Record of Processing Activity (GDPR Article 30). In the event of any inconsistency between this Annex and that document, the Record of Processing Activity (GDPR Article 30) shall prevail.

## Annex 2 - Technical and Organisational Measures

### Part A - Compliance readiness services

The Processor's technical and organisational measures implemented pursuant to Article 32 of the UK GDPR are not reproduced in full in this Agreement. They are documented in the following reference documents, which are incorporated by reference:

- The Processor's Information Security Policy, which sets out the Processor's overall information security posture and the controls applicable to Personal Data Processing.
- The Processor's ISO27001 ISMS Statement of Applicability, which identifies the Annex A controls selected and implemented by the Processor and the justification for their inclusion or exclusion.

The measures documented in those reference documents include, without limitation, controls addressing: encryption of Personal Data in transit; access controls and authentication; personnel confidentiality obligations; change management and secure development practices; incident response and breach notification procedures; and sub-processor security obligations.

The Processor shall not materially reduce the level of security documented in the above reference documents during the term of the Main Agreement without prior written notice to the Controller.

### Part B - Governance Tool Service

The Information Security Policy and the Statement of Applicability in Part A do not currently cover the Governance Tool Service. For it, the Processor's measures are those below, and the Service's security page describes them in more detail. The Processor shall not materially reduce them during the term of the Main Agreement without prior notice to the Controller. They are:

- **Sign-in.** No passwords: users sign in through Google, and only invited addresses or addresses at a domain the Controller has verified are admitted. Sessions last 12 hours. Permissions are checked on every request, so removing access takes effect immediately.
- **Separating customers.** PostgreSQL row-level security on every table holding an organisation's records. An automated test that tries to reach one organisation's records from another runs before every release.
- **Role-based access**, which can be confined to a single legal entity within the Controller's organisation.
- **Audit trail.** Every change is recorded in the same transaction as the change. Entries are append-only and SHA-256 hash-chained, and exports and downloads are themselves recorded.
- **Secrets.** Credentials for Controller Third-Party Services are encrypted with AES-256-GCM, using a key held outside the database.
- **Uploaded files.** File types are restricted to an allowlist and checked against their contents. Each file is fingerprinted, with the fingerprint checked on download. Files are scanned for viruses by a ClamAV scanner on the hosting provider's private network, so they are not sent to an outside scanning service.
- **Public Request Forms.** Each form has a random address that can be withdrawn. Submissions are rate-limited, and internet addresses are kept only as a keyed hash, for one day.
- **AI assistant.** Off unless the Controller turns it on. Common identifiers are removed before text is sent, and conversations are deleted after 30 days.
- **Network and browser.** HTTPS only, and the application reaches its database over the hosting provider's private network. A Content-Security-Policy and other security headers are sent with every page.
- **Logging.** Logs record sizes, durations and counts, not the content of records.
- **Backups.** The database is backed up daily, and each backup is kept for 27 days.
- **Secure development.** The source code is public under the AGPL-3.0. Every change is type-checked and runs the full automated test suite against a real database before release.

## Annex 3 - Sub-Processors

The current list of Sub-Processors authorised by the Controller under clause 6.1 of this Agreement is maintained in the Processor's separate Sub-Processor List document. That document is incorporated into and referenced by this Agreement. The Sub-Processor List is not reproduced here; the Controller may obtain the current version at any time by requesting it from the Processor.

The Processor shall update the Sub-Processor List and notify the Controller of any intended addition or replacement of a Sub-Processor in accordance with clause 6.3 of this Agreement.

For the shared Governance Tool Service, the Sub-Processor List at the date of this Agreement contains:

| Sub-Processor | What it does | Location | Transfer mechanism |
| --- | --- | --- | --- |
| **[Railway Corporation]** | Hosts the application, its database, backups and the virus scanner | EU West (Amsterdam) | UK approval of transfers to the EEA. **[Confirm the mechanism for any access from the US.]** |

The following are **not** Sub-Processors for the Governance Tool Service:

- **Controller Third-Party Services**, including the Controller's AI model provider (clause 6.5).
- **Google**, as the user's sign-in provider (clause 6.6).
- **Waivern's Cookie Consent Analyser**, which the Processor runs itself. When the Controller uses it, it receives the addresses of websites to scan, not the Controller's records.
- **Resend**, which the Processor uses only to email its own operators about organisation requests and feedback. That is the Processor's own data (clause 3.4).
`;
