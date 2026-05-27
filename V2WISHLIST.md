# CheapBugs V2 Wishlist

This is a planning scratchpad for a future CheapBugs v2 contract/index/broker architecture. The current v1 direction should remain focused and deployable; items here are candidates for the next contract deployment or a larger protocol refactor.

## Goals

- Preserve the current local-first/static/IPFS-friendly frontend model.
- Keep private bug details encrypted offchain until intentional reveal.
- Make public report metadata easier to index, display, notify on, and audit.
- Improve provenance and accountability around brokers.
- Reduce trust in any single broker without making the MVP too heavy.
- Make the system robust against malicious, lazy, censoring, or overly competitive brokers.

## Onchain report metadata improvements

### Add `title`

The v1 bug record has `reportId` and `publicSummary`, but no dedicated display title. V2 should add a short public-safe `title` field.

Suggested semantics:

- `reportId`: stable external identifier, URL/log/reference friendly.
- `title`: short public headline for cards, alerts, and report detail pages.
- `publicSummary`: longer public-safe description.

Candidate constraints:

- `reportId`: max 64 bytes.
- `title`: max 120-160 bytes.
- `publicSummary`: max 512-1024 bytes.
- `tags`: max 256 bytes.
- `encryptedPayloadCid`: max 128-256 bytes.

Important: `title` is public forever. The submit UI and broker validation must warn reporters not to include sensitive details, exploit specifics, private target references, credentials, unreleased vendor names, or anything that should stay encrypted.

### Persist `broker` on each bug

The v1 contract emits the publishing broker in `BugPublished` and includes the broker in the reporter-signed EIP-712 authorization, but the stored bug struct does not include broker. V2 should store it directly.

Suggested field:

```solidity
address broker;
```

Suggested semantics:

- Set `broker = msg.sender` in `publishBug`.
- Keep broker in `BugPublished`.
- Keep broker in the reporter-signed publish authorization.
- Expose broker through report getters and frontend types.

Why:

- Broker is core provenance, not just event history.
- Clients should not need to reconstruct report ownership from logs.
- Broker filtering, reputation, slashing, and accountability all need first-class broker identity.
- Alert/index services can include broker context without running a separate event indexer.

### Consider explicit public target hints

V1 stores `targetKind` and `targetRefHash`, keeping the full target reference private. That is good for safety, but V2 may want an optional, reporter-approved public hint.

Possible field:

```solidity
string publicTargetHint;
```

Examples:

- `Base wallet app`
- `WordPress plugin`
- `L2 bridge`
- `npm package`

Rules:

- Strictly optional.
- Public forever.
- Length capped.
- Must not replace encrypted target reference.
- Broker should reject hints that are too specific for private/embargoed reports.

## Broker-adversarial resilience

The broker role is powerful: brokers receive submissions, pin encrypted bundles, publish bug records, relay for review, reveal details keys, and complete payouts. V2 should assume brokers may be malicious, lazy, compromised, censoring, colluding, or overly competitive.

### Threats to handle

- **Censorship:** broker receives a valid report but refuses to publish it.
- **Front-running / theft of credit:** broker tries to publish, leak, or repackage a reporter's bug in a way that steals attribution.
- **Selective disclosure:** broker reveals private details to favored reviewers or competitors early.
- **Withholding:** broker pins poorly, loses data, refuses to reveal, or refuses to complete payout.
- **Overly competitive brokers:** brokers race to claim reports, spam low-quality submissions, pressure reporters, or attempt to lock reports into their own review path.
- **Collusion:** broker and reviewers coordinate to suppress competitors or manipulate payout weight.
- **Griefing:** broker publishes malformed/low-signal public metadata that damages indexing or alert quality.
- **Fee extraction:** broker adds hidden costs, off-protocol terms, or captive UX around submissions.

### Reporter-authorized broker binding

V1 already binds broker in the EIP-712 publish authorization. Preserve and strengthen that pattern.

V2 ideas:

- Include `broker` in the signed report authorization.
- Include `brokerTermsHash` or `brokerPolicyHash` so reporters know which broker rules they accepted.
- Include `brokerFeeBps` or explicit fee fields if broker fees become protocolized.
- Include deadline and nonce as today.
- Consider multi-broker authorization: reporter may authorize a set of brokers or a broker marketplace contract rather than a single broker.

### Broker receipt / non-censorship path

A broker who receives a report should give the reporter a signed receipt before or during intake.

Possible receipt fields:

```text
reportHash
reporter
broker
receivedAt
bugBundleHash
encryptedDetailsHash
detailsKeyCommitment
submissionChannel
brokerPolicyHash
```

V2 options:

- Store broker receipts offchain but make them verifiable.
- Let reporters publish a `BrokerReceipt` or `SubmissionIntent` if a broker censors them.
- Allow a reporter to reassign a report to another broker after timeout if the original broker fails to publish.
- Add a lightweight `reporterPublishIntent` path that commits to the report hash without revealing details.

### Broker handoff / reassignment

Reports should not be permanently trapped behind a bad broker.

Possible mechanisms:

- Reporter can authorize a new broker before publish.
- Reporter can revoke or supersede a broker authorization before publish.
- After publish, broker handoff can be allowed with reporter signature plus old/new broker events.
- If broker disappears before reveal or payout, an admin/multisig/recovery process can reveal the key or complete payout if the reporter supplied escrowed materials.

Questions:

- Should a report have exactly one active broker, or a primary broker plus fallback brokers?
- Should brokers be able to transfer responsibility voluntarily?
- Can reporter-approved broker migration happen without breaking payout order?

### Data availability requirements

A malicious or lazy broker can pin badly or lose encrypted bundles.

V2 ideas:

- Require broker to publish `bugBundleHash`, `encryptedDetailsHash`, and CID as today.
- Add optional multi-CID or mirror metadata.
- Add periodic data availability checks for encrypted payload CIDs.
- Add a broker bond that can be slashed if encrypted payload becomes unavailable before reveal.
- Encourage reporters to keep a local copy and recovery key.
- Consider separate `hoarder`/pinning role so data availability is not solely broker-dependent.

### Details-key custody and reveal resilience

Current flow relies heavily on broker-controlled reveal timing. V2 should improve guarantees.

Options:

- Reporter encrypts details key to multiple trustees/reviewers at submission time.
- Broker stores the details key commitment and an encrypted key-share bundle.
- Add timelocked fallback reveal by reporter, admin, or quorum if broker disappears.
- Use threshold encryption or Shamir shares for reveal after `revealAfter`.
- Penalize brokers who fail to reveal after status/payout conditions are met.

Avoid revealing private details automatically unless the disclosure mode and reporter consent make that safe.

### Broker reputation and accountability

Track broker quality over time.

Potential public metrics:

- reports published
- reports censored/disputed
- average time to publish
- average time to reveal
- payout completion rate
- data availability failures
- valid/invalid/spam ratio
- reviewer dispute rate

Potential onchain fields/events:

- `BrokerReportPublished`
- `BrokerReportTransferred`
- `BrokerTimeout`
- `BrokerSlashed`
- `BrokerDisputed`

V2 does not need full slashing immediately, but the data model should not block it.

### Anti-front-running and attribution protection

A broker should not be able to steal a reporter's bug.

Ideas:

- Reporter signs `reportHash`, `reporter`, `broker`, `bugBundleHash`, `encryptedDetailsHash`, and `detailsKeyCommitment`.
- Reporter signature must be included in `publishBug`.
- Report hash should include reporter address and content commitments.
- Broker cannot change public summary/title/tags without invalidating reporter signature.
- Consider a public `reporterCommit(reportHash)` transaction so reporters can timestamp a report before choosing a broker.
- Consider a private or cheap intent layer for timestamped commitments without revealing metadata.

### Handling overly competitive brokers

If multiple brokers compete for the same reporter/report, V2 should reduce chaos.

Ideas:

- Broker authorization is explicit and signed; only the authorized broker can publish.
- Reporter can intentionally multi-authorize brokers, but the first valid publish consumes the report hash.
- Broker marketplaces should show public terms, fee schedules, expected review process, and reputation.
- Prevent brokers from spamming duplicate reports by requiring unique `reportHash` and content commitments.
- Consider broker stake/bond requirements for publishing rights.
- Rate-limit or bond broker publication if spam becomes a problem.

## Review and payout improvements

### Store payout/reward policy inputs more explicitly

V1 stores `payoutAmount`, `payoutMultiplier`, `payoutCompleted`, status, and insertion-order payout cursor. V2 could store more decision context.

Ideas:

- status reason hash or short public status note
- payout rationale hash
- reviewer quorum snapshot
- vote totals at payout time
- payout recipient override only with reporter signature
- broker fee, if any

### More flexible payout ordering

V1 ordered payouts are simple but may create bottlenecks if one report is stuck.

V2 ideas:

- Keep ordered payout as default, but allow admin-skipped zero-payout slots for invalid/spam reports.
- Add timeout paths for stuck reports.
- Allow independent payout queues per broker, per severity, or per epoch.
- Ensure a malicious broker cannot block all later payouts by refusing to complete one slot.

### Better dispute hooks

Add protocol room for disputes without overbuilding.

Possible events/fields:

- `ReportDisputed(reportHash, disputer, reasonHash)`
- `BrokerDisputed(reportHash, broker, reasonHash)`
- `PayoutChallenged(reportHash, challenger, reasonHash)`
- `DisputeResolved(reportHash, outcome)`

Keep full dispute evidence offchain/IPFS, with public-safe hashes onchain.

## Frontend and alerting implications

V2 should make report cards and Farcaster alerts easier and safer.

Needed public fields:

- `reportId`
- `title`
- `broker`
- `reporter`
- `createdAt`
- `disclosureMode`
- `targetKind`
- optional `publicTargetHint`
- `tags`
- `status`
- `payoutCompleted`
- `payoutAmount`
- `payoutMultiplier`

Alert service should never include private details. Default notification text can use:

- title
- payout amount
- target kind or public target hint
- tags
- status/payout event type

## Migration notes

Adding `title`, `broker`, or other fields to the stored bug struct likely requires a new deployment if the current contract is not upgradeable.

V2 migration options:

- Deploy `CheapBugsBugIndexV2` and point frontend config to the new address.
- Keep V1 readable for historical reports.
- Add frontend support for both V1 and V2 report shapes.
- Consider a one-time migration/import event for V1 reports if useful.
- Keep V2 EIP-712 domain/name distinct enough that signatures are not confused with V1.

## Open questions

- Should V2 support multiple brokers per report, or exactly one active broker?
- Should broker bonds be required from day one?
- Who can slash brokers, and what evidence is required?
- Should reporter publish intents be free, bonded, or sponsored?
- How much public metadata is useful before it becomes dangerous?
- Should payout queues be global, per broker, or per epoch?
- Should reviewers be broker-selected, protocol-selected, or open weighted voters?
- Should `title` be mutable by reporter/broker before reveal, or immutable once published?
- How should broker fees be represented if brokers eventually monetize intake/review work?
