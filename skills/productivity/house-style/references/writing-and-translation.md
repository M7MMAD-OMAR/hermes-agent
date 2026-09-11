# House writing and translation standard

Read this before writing any deliverable: a document, a deck, copy, a README, a
commit message, a code comment, a chat reply. It is a checklist, not an essay.

## 1. Punctuation: the hard rule

**No em dash. No en dash. In any language, in any deliverable.** The characters are
U+2014 and U+2013. Replacements, in order of preference:

| Instead of the long dash | Use | Example |
|---|---|---|
| Parenthetical aside | commas | `The model, trained on 2024 data, missed it` |
| Explanation after a statement | a colon | `One cause: stale cache` |
| Two linked clauses | a semicolon | `The build passed; the tests did not` |
| Afterthought | a full stop | `It failed. Twice.` |
| Range | the word "to" | `45 to 90`, `2019 to 2024` |
| Attribution | a comma | `Butterick, Practical Typography` |

ASCII hyphens in compounds (`read-alone`, `state-of-the-art`) are allowed.

Arabic does not use the long dash natively, so the substitutes are the natural ones:
the Arabic comma `،` or parentheses for an aside (`المشروع، الذي بدأ في 2023، ما زال
قائماً`), a colon for an explanation (`السبب: تأخر التوريد`), `و` or a new sentence
for a join, and `من ... إلى ...` for a range (`من 45 إلى 90 حرفاً`).

Check before delivering: `grep -P '[\x{2013}\x{2014}]' <file>` returns nothing.
Also: one space after a full stop, `،` and `؛` in Arabic rather than `,` and `;`.

## 2. Structural tells

Page-level faults, invisible sentence by sentence and obvious to a reader. Fix these
before touching vocabulary.

**The filled template.** Every field has content because the field exists: kicker,
heading, lead, a description under each card, a caption under each figure. A writer
leaves a field empty when there is nothing to put in it.

**Self-restatement.** A label's description says the label again in longer words.

> **Catering and Meals for Residents**
> *Catering and meal services for residential communities and workplaces.*

**The announcement.** A section opens by telling the reader what follows, above items
that say exactly that. The items are visible. Delete the announcement.

**Fractal summary.** A summary at page level, section level and card level. The
reader is told the same thing at four scales.

**Over-signposting.** "In this section we will examine", "Having established X, we
now turn to Y", "As mentioned above". Headings already signpost. Cut all of it.

**The exhaustive list.** Five items ending in "or investment" because nothing may be
left out. A person picks three and stops.

**The justifying sentence.** A sentence whose only job is to explain why the previous
sentence mattered.

### Test A: substitution, run on every sentence

1. Replace the subject's name with a competitor's, or with "any company".
2. Still true? Delete the sentence. Do not reword it.
3. If a whole section dies, it has no facts yet. Ask for them: how many, since when,
   where, run by whom, what changed last year.
4. **Never invent a figure to refill the slot.** Leave it out, or say it is unavailable.

| Sentence | Verdict |
|---|---|
| `We deliver tailored solutions that empower our clients to succeed.` | true of a dentist, delete |
| `We are committed to the highest standards of governance.` | true of anyone, delete |
| `Eskan runs 13 communities in Abu Dhabi, with capacity for 95,161 beds.` | keep |

### Test B: self-restatement, run on every card, bullet, caption and table note

1. Cover the description. Read only the label.
2. Does the description add anything the label did not? If no, delete the field.
3. Do not reword it. Put a fact there instead:
   `Workforce accommodation, 13 communities, 95,161 beds`.

### Test C: layer count

Count how many times a section says what it is about before it says anything. The
ceiling is kicker, heading, one sentence. If the items carry their own labels, the
section usually needs no lead sentence at all.

## 3. Sentence rhythm, with targets

Uniform sentence length is the most reliable statistical signature of machine
writing: 15 to 18 words, every time. Human writing lurches.

```
sentence_length_stdev(any 10-sentence window)    >= 6 words
shortest sentence in any paragraph               <= 8 words
paragraph_length_stdev                           >= 25 words
tricolons per 400 words                          <= 1
consecutive items opening with the same word     == 0
consecutive sentences opening with the same word == 0
```

- Put a five-word sentence next to a twenty-word one. Fragments are allowed:
  `Held long term, operated in-house.`
- Fix uniform rhythm by cutting one sentence hard, not by lengthening another.
- One tricolon per page is elegant. Three is a pattern, and readers feel patterns
  before they identify them.
- **Repeat the noun.** Do not cycle "communities", "developments", "residential
  assets", "living environments" in one section. Repetition reads as confidence.
- Present tense, and the verb the organization actually performs. Not `aims to`,
  `seeks to`, `is committed to`, `strives to`, `is designed to`, `works to`.
- Every figure carries unit, date and source: `AED 20.77 billion, revenue in 2025
  (20% YoY growth)`, not "significant growth". Never write a paragraph explaining
  what a figure means; if it needs one, you picked the wrong figure.

## 4. Word lists

Treat a hit as a prompt to look, not a verdict. A list from one industry misses
another industry's tells entirely.

**General LLM lexicon:** delve, delving, intricate, commendable, meticulous,
surpass, elevate, foster, tapestry, realm, navigate, landscape of, pivotal,
resonate, testament to, underscore, showcasing, compelling, paramount, crucial,
unwavering, alignment.

**Corporate lexicon:**

- Hollow intensifiers: world-class, best-in-class, state-of-the-art, cutting-edge,
  unparalleled, seamless, robust, holistic, vibrant, bespoke.
- Consultant verbs: leverage, utilise, empower, unlock, harness, drive, enable,
  facilitate, spearhead.
- Commitment formulas: committed to excellence, dedicated to delivering, we pride
  ourselves on, we believe that, our mission is to.
- Bridges and filler: in today's, in an era of, moreover, furthermore, it's worth
  noting, when it comes to, that said.
- Pompous copulas: serves as, stands as, plays a key role, positions itself as.
  The word is usually "is".
- Ornament: journey, ecosystem, redefining, reimagining, at the heart of, more than
  just, setting a new standard, a new era.
- False ranges: "from strategy to execution", where the endpoints are not a spectrum.
- Negative parallelism: "not just X, but Y". Manufactured profundity.
- Manufactured suspense: "Here's what sets us apart", "The result?".

**Arabic equivalents:** حلول مبتكرة، رؤية طموحة، نسعى جاهدين، نلتزم بأعلى المعايير،
شريك استراتيجي موثوق، في عالمنا المعاصر، تجدر الإشارة إلى، يلعب دوراً محورياً. Same
fault as the English: true of anyone, checkable by no one.

### Not a tell, do not over-correct

A short page. A repeated noun. A sentence fragment, which a blind reviewer once named
as evidence of a human writer because a machine adds the verb. A technical term a
general reader will not know, when the audience is not general. A bare list with no
descriptions. A number with no adjective: `95,161 beds` needs nothing. Plain "is".

## 5. Writing Arabic

**Register.** Modern Standard Arabic, full sentences, no dialect, no ceremonial
padding. More formal than business English, but **not more verbose**.

**Translationese, signs that Arabic was written through English:**

- English sentence boundaries preserved one to one.
- Passive copied from English where Arabic prefers an active verb or a named agent.
- `قام بـ` plus a verbal noun where a plain verb works: `قيّمنا`, not
  `قمنا بإجراء تقييم`.
- Literal calques: `في نهاية اليوم`, `خارج الصندوق`. Neither means anything in Arabic.
- English punctuation, and Latin brand names transliterated inconsistently.

**No synonym cycling.** Fix one Arabic term per concept and repeat it. If `مشروع` is
the word, it does not drift to `مبادرة` then `برنامج` then `منظومة` for variety. In a
technical document that drift is an error, not a style.

**Digits.** Choose Western Arabic (`0 1 2 3`) or Eastern Arabic-Indic (`٠ ١ ٢ ٣`)
once per document and never mix. Western is the default for Gulf and Levant business
documents, Eastern for Egypt-facing formal publishing. Numbers, dates, percentages
and code always read left to right inside Arabic text.

**Typographic bans:** no italics (use a heavier weight), no synthetic bold, no
letter-spacing or tracking (Arabic is cursive and tracking breaks the joins), no
all-caps or small-caps, no full justification (set flush-right, ragged-left), no
hyphenation. Line height 1.6 to 1.8, against 1.4 to 1.5 for Latin.

## 6. Translation

**The principle.** Translate meaning for the target reader, not form. A target text
carrying source-language syntax reads as foreign even when every word is correct.
That, not mistranslation, is the usual failure.

**Idiom priority order.** Apply in order, stop at the first that works:

1. An existing target idiom with the same sense, even if the image differs.
   `He let the cat out of the bag` becomes `أفشى السر`.
2. A target idiom with a different image but the same force.
3. Plain non-idiomatic paraphrase of the sense. Always acceptable.
4. Literal rendering plus a gloss, only for religious, legal or literary text where
   the source image itself matters.

Never calque an image the target culture does not use.

**English to Arabic.** Raise the register, not the word count. Merge choppy English
sentences where Arabic expects a longer period, using `و` and `ف` as connectives.
Delete English filler rather than finding an Arabic equivalent for it. Expect roughly
20 to 25% fewer characters and about the same rendered width; leave 10 to 15% slack
in any fixed container anyway.

**Arabic to English.** Split long coordinated periods into separate sentences. Drop
ceremonial formulas that carry no information in English. Turn nominal constructions
into verbs: `تم إجراء تقييم` becomes `We assessed`, not `An assessment was
conducted`. Cut the hedging that is politeness in Arabic and vagueness in English.

**Glossary discipline.** Fix terminology before translation starts, in a written
glossary: every product name, role title, technical term and recurring noun, with one
approved rendering each. A term needing two renderings gets both listed, with the
rule for choosing.

**Back-translation is a check, not a method.** Back-translate only the ten
highest-stakes sentences: figures, obligations, commitments, legal claims, safety
instructions. Compare meaning, not wording. A back-translation matching word for word
means you translated formally, which is the failure and not the success.

**Never translate.** Names of people, companies and products; Latin brand names;
standard and certification codes; units; figures; code, identifiers and file paths;
quoted legal text with an official version. Localize dates, currency, decimal
separators, measurement systems and diagram direction, but never paraphrase a number.

## 7. Before you deliver

```
[ ] grep for U+2013 and U+2014 returns nothing
[ ] substitution test run on every sentence; universal sentences deleted
[ ] self-restatement test run on every card, bullet and caption
[ ] layer count <= kicker + heading + one sentence per section
[ ] no announcements, no fractal summaries, no over-signposting
[ ] sentence length varies: stdev >= 6 words in every 10-sentence window
[ ] no four consecutive items opening with the same word
[ ] nouns repeated, not cycled through synonyms
[ ] every figure carries unit, date and source; no invented figures
[ ] word lists checked, hits inspected rather than auto-replaced
[ ] nothing cut that was on the "not a tell" list
[ ] Arabic: no italics, no tracking, no all caps, no justification, digits consistent
[ ] translation: glossary applied, ten stakes sentences back-translated for meaning
[ ] names, codes, units and figures left untranslated
```
