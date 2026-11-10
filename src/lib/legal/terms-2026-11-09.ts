/**
 * The Terms of Service for Waivern's hosted service, version of 9 November 2026,
 * exactly as accepted. Never edit a published version: a change is a new
 * version, which applies by notice under clause 12.1 (see `documents.ts`).
 */
export const TERMS_2026_11_09 = `
## 1. About these terms

1.1 These terms apply when you use the free hosted Waivern Governance Tool service. Read them before you ask for an organisation, accept an invitation or use the Service. By doing any of these, you accept the terms.

1.2 **Who we are.** The Service is run by Waivern Limited, a company registered in England and Wales under company number 16375372. Our registered office is 14 Eastbury Road, Petts Wood, Orpington, Kent BR5 1JW, and our VAT registration number is 505766383. You can contact us at info@waivern.com. In these terms, "Waivern", "we", "us" and "our" mean Waivern Limited.

1.3 **Who may use the Service.** Organisations and individuals may both use the Service. You must be at least 18.

- **If you use it for an organisation**, you confirm that you have authority to accept these terms for that organisation and that the organisation is bound by them. You also accept them personally, as a user.
- **If you use it for yourself**, you accept these terms as an individual. If you use it for purposes wholly or mainly outside your trade, business, craft or profession, you are a consumer, and section 13 also applies to you.
- **Every Authorised User** must accept these terms personally before using the Service, whoever invited them.

1.4 **Not for law enforcement bodies.** You may not use the free Service if you are a competent authority under Part 3 of the Data Protection Act 2018, such as a police force, prosecutor, or prison or probation service. Use a dedicated instance instead, either hosted by Waivern under a separate agreement or run by your own organisation under the open-source licence.

1.5 **Other documents.** These terms also take in our [Privacy Notice](https://www.waivern.com/privacy-policy). They also take in our [Data Processing Agreement](https://www.waivern.com/data-processing-agreement), which applies whenever we process personal data for you. If these terms and the Data Processing Agreement conflict about personal data, the Data Processing Agreement wins.

1.6 **Paid services.** A dedicated instance, technical support, training and custom modifications are not part of the free Service. They are provided only under a separate written agreement signed by Waivern.

## 2. Definitions

| Term | Meaning |
| --- | --- |
| **Customer**, **you** | The organisation or individual using the Service, and each person who uses it on that organisation's behalf |
| **Service** | The free, shared hosted Waivern Governance Tool service at **https://govern.waivern.com**, including its public pages, request forms and integration API |
| **Software** | The Waivern Governance Tool source code, published under the GNU Affero General Public License v3.0 (AGPL) |
| **Customer Data** | Everything you or your users put into the service, or that reaches it on your behalf. This includes records, files, request-form submissions, integration traffic and assistant conversations |
| **Authorised User** | A person you invite to your organisation in the service, or who signs in through an email domain you have verified |
| **Third-Party Service** | A service the Service connects to at your choice that Waivern does not provide, such as your AI model provider, your Google account or another tool linked through the API |
| **Data Protection Law** | The UK GDPR, the Data Protection Act 2018, the Privacy and Electronic Communications Regulations 2003 and the Data (Use and Access) Act 2025, as amended |

## 3. The free service

3.1 **What it is.** The Service lets your organisation keep its records of processing, assessments, risks, data protection requests, breaches, complaints and AI systems. It also routes decisions about them to named people and keeps an audit trail. It is provided free of charge.

3.2 **Shared service.** The Service is shared by many organisations and individuals on one application and database. It is hosted by Railway, in its EU West (Amsterdam) region. Records are kept apart by technical controls described on our Security page at https://govern.waivern.com/security. That page describes how the Service currently works. It is not a promise that it will always work that way, except where these terms or the Data Processing Agreement say so.

3.3 **Asking for an organisation.** You can ask for an organisation after signing in with a Google account whose address Google has verified. We decide whether to approve a request, at our discretion and without having to give reasons. We may also stop accepting new requests at any time.

3.4 **Your users and accounts.**

- You decide who to invite and what role each person holds. You are responsible for everything done through your organisation's accounts.
- Your users must keep their sign-in accounts secure. Tell us promptly at info@waivern.com if you think an account has been misused.
- Sign-in uses Google. We are not responsible for Google's service or for losing access to a Google account.

3.5 **The open-source licence.** The Software is licensed under the AGPL, and nothing in these terms limits your rights under it. You may download the Software and run it yourself. These terms govern only your use of the Service that Waivern hosts. They do not give you any right to Waivern's names, logos or trade marks.

3.6 **Feedback.** If you send us feedback or suggestions, we may use them freely and without paying you.

## 4. Not legal advice: your decisions stay yours

4.1 **Not legal advice.** The Service is a record-keeping and workflow tool. It is not legal, regulatory or professional advice, and it creates no adviser–client relationship. That includes its questions, red and amber flags, checklists, templates, deadlines, help pages, citations and assistant answers. Waivern is not a firm of solicitors.

4.2 **Your decisions.** You alone are responsible for:

- whether your organisation complies with Data Protection Law and any other law;
- every decision you record in the Service, such as a lawful basis, an assessment outcome, a risk acceptance, a breach report or a reply to a data subject; and
- checking that the Service's content is right for your circumstances before you rely on it.

The Service records who decided what. It does not decide anything, and a named person in your organisation always does.

4.3 **Law changes.** We try to keep the Service in line with UK law as it changes. We do not promise that it reflects the law in force at any given time, or that any date, deadline or rule it shows is correct. Check anything you rely on against the legislation or with a qualified adviser.

4.4 **No regulator approval.** Using the Service does not mean you comply with any law or standard. The Information Commission, the UK's data protection regulator, or any other regulator has not approved or certified it.

4.5 **The AI assistant.** The assistant is off unless your administrator turns it on.

- When it is on, it uses an AI provider, model and account that you choose and pay for. That provider is a Third-Party Service. Your contract with it governs what it does with what is sent to it.
- You decide what is sent to it. The Service tries to remove common personal identifiers before sending, but this is not guaranteed. Do not paste personal data into the assistant.
- AI output can be wrong, incomplete or out of date. It is a draft for a person to check, never a decision or advice from Waivern.
- We delete assistant conversations after **30** days.

4.6 **Third-Party Services.** We are not responsible for any Third-Party Service. That includes its availability, security, charges, output, or what it does with data you send it. You use them under their own terms.

## 5. Acceptable use

5.1 You must not use the Service, or let anyone else use it, to:

1. break any law, or infringe anyone's rights, including their intellectual property or data protection rights;
2. upload malware, or any file you know or suspect is harmful;
3. try to reach another organisation's records, probe or test the Service's security, or get round its limits or controls, unless we have agreed it in writing (see 5.3);
4. overload, disrupt or degrade the Service, including by automated scraping or excessive API calls;
5. store special category data, criminal offence data or other high-risk personal data, except as the Service's own registers need for their purpose, such as recording a data protection request, complaint or breach;
6. use the Service as general file storage, or keep data in it that has nothing to do with governance and compliance;
7. use the public request forms to collect anything other than genuine data protection requests and complaints;
8. send unsolicited marketing, or harass or deceive anyone;
9. resell, sublicense or give third parties access to the hosted Service, other than your Authorised Users and people you send contributor links to; or
10. copy or imitate Waivern's branding, or suggest that Waivern endorses you.

5.2 **Your data.** You must have every right, notice and lawful basis needed to put Customer Data into the Service and to let us process it under these terms.

5.3 **Security problems.** If you find a security weakness, report it privately to info@waivern.com and do not exploit it. Good-faith testing that you have agreed with us in writing is not a breach of 5.1.

5.4 **What we may do.** If we reasonably believe you have broken this section, we may take any of the steps in section 11. We may also remove or block the content concerned, and we may report illegal activity to the authorities.

## 6. Your data and data protection

6.1 **You own your data.** Customer Data stays yours. You give Waivern a non-exclusive, royalty-free licence to host, copy, process and transmit it only as needed to provide, secure, maintain and improve the Service, and to meet our legal obligations.

6.2 **Roles.** You are the controller of any personal data in Customer Data, and Waivern processes it for you as your processor. This includes data subjects' details sent through your public request forms. Our Data Processing Agreement sets out the terms required by Article 28 of the UK GDPR, and it forms part of these terms.

6.3 **Our own data.** Waivern is controller of the account and usage data we need to run the Service, such as names, email addresses, sign-in records, organisation requests, feedback and security logs. Our Privacy Notice explains how we use it.

6.4 **Where data is held.** The Service is hosted in **the EU (Amsterdam)**, outside the UK. By using the Service you accept that Customer Data will be held there. If your organisation needs its records held in the UK, the free Service is not suitable.

6.5 **The audit trail.** The Service's audit trail is append-only by design, so entries cannot be edited or deleted while your organisation exists. Section 11.5 explains what happens at the end.

6.6 **Aggregate information.** We may use anonymised, aggregated information about how the Service is used, such as counts of features used, to run and improve it. That information never identifies you or any individual.

## 7. Support, availability and backups

7.1 **Support.** We do not have to provide support of any kind for the free Service. Any help we give is a courtesy, may stop at any time, and does not create an obligation to help again. Paid technical support is available under a separate agreement.

7.2 **Availability.** We do not promise that the Service will be available at any time or for any length of time. It may be interrupted for maintenance, updates, incidents or outages at our hosting provider. We will try, but do not promise, to give notice of planned downtime.

7.3 **Backups.** We back up the shared database daily and keep each backup for 27 days. Backups exist so the whole Service can recover from a failure.

- A restore brings back every organisation's records together, to the most recent backup or another point we choose. We will not restore data for one organisation alone.
- Anything entered after the backup used may be lost in a restore. We do not promise that any particular data can be recovered.
- **Keep your own copies of anything you need**, using the Service's exports.
- If we fail to take or keep a backup, our liability is limited as set out in section 9.

7.4 **Changes to the Service.** We may add, change or remove features, limits or integrations at any time, including how the Service is hosted. We will try to give reasonable notice of changes that take away a significant feature you use.

## 8. No warranties

8.1 **As is.** The Service is provided free of charge, "as is" and "as available". You use it at your own risk.

8.2 **No promises.** To the fullest extent the law allows, Waivern gives no warranty, representation, condition or other term, whether express or implied by statute, common law or otherwise. That includes any about:

- satisfactory quality or fitness for a particular purpose;
- the use of reasonable care and skill;
- accuracy, completeness or currency, including of any legal content, citation, deadline or AI output;
- the Service being uninterrupted, secure, free of errors or viruses, or compatible with your systems; and
- the Service meeting your requirements, or helping you comply with any law.

8.3 **No reliance on other statements.** You accept that in using the Service you have not relied on any statement, promise or description that is not set out in these terms. That includes statements on our website, Security page, help pages, marketing or the Software's documentation. This does not limit liability for fraudulent misrepresentation.

## 9. Limitation of liability

9.1 **What we do not limit.** Nothing in these terms excludes or limits any liability that cannot be excluded or limited under English law, including liability for:

1. death or personal injury caused by negligence;
2. fraud or fraudulent misrepresentation; and
3. any other matter for which the law does not allow liability to be excluded or limited.

9.2 **Why the limits are low.** The Service is free. We cannot check how you use it or what you put in it, and you can keep your own copies of your data and take your own advice. The limits in this section reflect that, and they are a condition of offering the Service free of charge.

9.3 **Losses we exclude.** Subject to 9.1, Waivern is not liable to you, whether in contract, tort (including negligence), breach of statutory duty, misrepresentation, restitution or otherwise, for any:

1. loss of profits, revenue, sales, business, contracts or anticipated savings;
2. loss of, damage to or corruption of data, or the cost of recreating it;
3. loss of goodwill or reputation;
4. wasted expenditure or management time;
5. fine, penalty, regulatory sanction or compensation you are ordered or agree to pay, or the cost of any regulatory investigation;
6. loss arising from a decision you made or recorded, or from your reliance on any content or AI output in the Service;
7. loss caused by a Third-Party Service, your hosting provider's failure, or events outside our reasonable control; or
8. indirect or consequential loss.

9.4 **Our total liability.** Subject to 9.1 and section 13, Waivern's total liability to you for all claims arising out of or in connection with these terms or the Service is limited to **£10,000**, whatever the cause and however many claims there are.

9.5 **Time limit for claims.** Subject to 9.1, you must bring any claim against Waivern within 12 months of the date on which you became aware, or ought reasonably to have become aware, of the facts giving rise to it.

9.6 **Each limit stands alone.** Each exclusion and limit in this section is separate. If a court finds any of them unenforceable, the others still apply.

## 10. Your indemnity

10.1 You will indemnify Waivern, its directors, employees and subcontractors against all losses, damages, fines, costs and expenses, including reasonable legal fees, arising from any claim, investigation or demand by a third party or a regulator that arises out of:

1. Customer Data, including a claim that it infringes someone's rights or that you had no lawful basis to put it in the Service;
2. your or your users' breach of section 5 (Acceptable use);
3. your breach of Data Protection Law or any other law; or
4. any decision you made or recorded using the Service.

10.2 **How claims are handled.** We will tell you promptly about any claim covered by 10.1 and give you reasonable help, at your cost. We will not settle it without your agreement, which you must not unreasonably withhold. You may take over the defence of the claim with counsel we reasonably accept.

10.3 You do not have to indemnify us to the extent a loss was caused by Waivern's own breach of these terms or the Data Processing Agreement.

## 11. Suspension and ending the Service

11.1 **Suspension.** We may suspend all or part of your access, immediately and without notice, if we reasonably believe that:

- you have broken these terms;
- your use poses a risk to the Service, to other organisations or to us; or
- suspension is needed to comply with the law or a request from a regulator, court or law enforcement body.

Where it is lawful and practical, we will tell you why.

11.2 **Ending your use.** You may stop using the Service at any time. To have your organisation closed, ask its owner to email info@waivern.com.

11.3 **Ending for breach.** We may end your access immediately by notice if you seriously or repeatedly break these terms.

11.4 **Ending for any reason.** We may end your access, or withdraw the free Service altogether, for any reason by giving at least **30** days' notice by email to your organisation's owners. We do not have to give reasons.

11.5 **Your data at the end.**

- After notice under 11.4, you can export your data during the notice period.
- After any other ending, we will, where lawful and practical, give you **14** days to export your data. We do not promise to give you that period.
- After that we will delete Customer Data, including the audit trail, from the live Service within **30** days. Copies in backups are overwritten in the normal backup cycle, within **27** days. The Data Processing Agreement governs return and deletion of personal data.

11.6 **What survives.** Sections 4, 6.5, 8, 9, 10, 11.5, 12 and 13, and any other term meant to survive, continue after your use ends.

## 12. Changes to these terms, and general terms

12.1 **Changing these terms.** We may change these terms, and the Data Processing Agreement, from time to time, for example as the Service or the law changes.

- We will publish each new version with the date it takes effect, and keep every earlier version available to read.
- When a new version takes effect, we will email your organisation's owners to tell them, with a summary of what has changed and a link to the new version.
- The new version applies to you, and to your organisation, from the date it takes effect. You do not need to accept it again to keep using the Service.
- If your organisation does not agree to a change, an owner may end its use of the Service by emailing info@waivern.com within **30** days of the change taking effect, or of our email about it if that is later. We will then close your organisation as described in 11.2 and 11.5, without charge.
- A change cannot remove a protection that Article 28(3) of the UK GDPR requires the Data Processing Agreement to give.

12.2 **Events outside our control.** We are not liable for any delay or failure caused by events outside our reasonable control. Examples are a failure at our hosting or sign-in provider, a cyber attack, a power or network failure, industrial action or an act of government.

12.3 **Transfer.** We may transfer our rights and obligations under these terms to another organisation, for example on a sale of the business, and we will tell you if we do. You may not transfer yours without our written consent.

12.4 **Entire agreement.** These terms, the Privacy Notice and the Data Processing Agreement are the whole agreement between you and Waivern about the Service. They replace any earlier arrangement or understanding about it.

12.5 **Severance.** If a court decides any part of these terms is unenforceable, that part is changed as little as possible to make it enforceable, and the rest stays in force.

12.6 **No waiver.** If we delay or do not enforce any right, we have not given it up.

12.7 **Third parties.** No one other than you and Waivern has any right to enforce these terms, whether under the Contracts (Rights of Third Parties) Act 1999 or otherwise. The exception is the people named in section 10.1, who may rely on it.

12.8 **Notices.** We may send notices to the email addresses of your organisation's owners. Send notices to us at info@waivern.com.

12.9 **Law and courts.** These terms, and any dispute or claim arising out of or in connection with them or their subject matter, are governed by the law of England and Wales. This includes non-contractual disputes. The courts of England and Wales have exclusive jurisdiction.

## 13. If you are a consumer

13.1 **When this section applies.** This section applies only if you use the Service as a consumer, as described in 1.3. Where it conflicts with any other part of these terms, this section wins.

13.2 **Your legal rights.** Nothing in these terms affects your rights under the Consumer Rights Act 2015 or other consumer law that cannot be excluded or limited. Section 8 and section 9.3 apply to you only so far as the law allows. Citizens Advice can tell you more about your rights.

13.3 **Damage to your device.** If the Service damages a device or digital content belonging to you because we did not use reasonable care and skill, we will either repair the damage or pay you fair compensation.

13.4 **What we are responsible for.** We are responsible for loss or damage you suffer that is a foreseeable result of our breaking these terms or failing to use reasonable care and skill. We are not responsible for loss that was not foreseeable. We are not responsible for business losses, because you use the Service for private purposes. The limit in 9.4 applies, unless the law does not allow it.

13.5 **Indemnity.** Section 10 does not apply to you. You remain responsible under the general law for loss you cause by breaking these terms.

13.6 **Ending.** You can stop using the Service and close your account at any time, at no cost. We will suspend or end your access only on the grounds set out in section 11, and we will act reasonably when we do.

13.7 **Courts.** If you live in Scotland, you may bring proceedings in the Scottish or the English courts. If you live in Northern Ireland, you may bring them in the Northern Irish or the English courts.

*These terms take effect on 9 November 2026.*
`;
