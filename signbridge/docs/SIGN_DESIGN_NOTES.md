

## Three things to know first

- **Which sign language:** The signs here are from ASL (American Sign Language), which has many one-handed signs and free video dictionaries (Lifeprint, Handspeak). Indian Sign Language (ISL) uses more two-handed signs and signs some words differently. If evaluators expect ISL, check each word on the ISLRTC (Indian Sign Language Research and Training Centre) dictionary before training it.
- **What the glove can detect:** which fingers are bent (flex sensors) and which way the hand is tilted or moving (MPU6500). It can't detect *where* the hand is, like touching the chin versus the chest. Two signs with the same finger shape look identical to the glove unless tilt or movement differs.
- **Train the ending position:** For signs that move, hold the final position for about a second when training and when testing.

## Hand shapes the glove can tell apart

The glove can reliably separate 12 hand shapes plus an idle open hand. Pattern order is Thumb, Index, Middle, Ring, Pinky; 1 = bent, 0 = straight. Match this to whichever sensor sits on which finger.

| Hand shape | Pattern (T I M R P) | Used for |
| --- | --- | --- |
| Open hand, fingers spread | 0 0 0 0 0 | Keep as resting / idle |
| Flat hand, thumb tucked in | 1 0 0 0 0 | Hello, Thank you, Please, Welcome, number 4 |
| Fist | 1 1 1 1 1 | Yes, Sorry |
| Thumbs up | 0 1 1 1 1 | Good / Okay |
| Index finger only | 1 0 1 1 1 | Where, 1, Up/Down, Shh, Question |
| Index + middle (V) | 1 0 0 1 1 | 2 |
| Thumb + index + middle | 0 0 0 1 1 | 3 |
| Thumb + index (L) | 0 0 1 1 1 | Library |
| Thumb + pinky (Y) | 0 1 1 1 0 | Phone / Call |
| Thumb + index + pinky | 0 0 1 1 0 | I love you, Airplane |
| Index + middle + ring (W) | 1 0 0 0 1 | Water |
| OK sign (thumb touching index) | 1 1 0 0 0 | Okay |
| Pinky only | 1 1 1 1 0 | Washroom |

When two words share a shape, the MPU's tilt or movement has to separate them.

## Daily basics

Four common greetings share the flat-hand shape, so tilt or movement decides between them.

| Word | How to sign it (one hand) | Pattern (T I M R P) | How the glove separates it |
| --- | --- | --- | --- |
| Hello | Flat hand at forehead, move outward like a salute | 1 0 0 0 0 | Palm facing forward, fingers up |
| Thank you | Flat hand fingertips at chin, move forward and down | 1 0 0 0 0 | Ends with palm facing up |
| Please | Flat hand rubs a circle on the chest | 1 0 0 0 0 | Palm facing you + circular movement |
| Welcome | Flat hand sweeps in toward the body | 1 0 0 0 0 | Sideways sweep |
| Bye | Open hand, fingers fold down a few times (or wave) | 0 0 0 0 0 | Needs movement detection (looks like idle) |
| Yes | Fist nods up and down at the wrist | 1 1 1 1 1 | Nodding movement |
| Sorry | Fist rubs a circle on the chest | 1 1 1 1 1 | Circular movement |
| No | Index and middle fingers snap shut onto thumb | Changes during sign | Easier: index finger wag side to side |
| Okay | OK sign or thumbs up\* | 1 1 0 0 0 / 0 1 1 1 1 | Unique shape |
| I love you | Thumb, index and pinky out | 0 0 1 1 0 | Unique shape |
| Excuse me | Two-handed in ASL | — | Use a raised index finger\* ("one moment") instead |

\* = a widely understood gesture rather than a formal sign. Worth saying so in the presentation.

## Scenario signs

Each scenario has 3–5 usable one-handed signs; Thank you, Okay and Yes/No work everywhere.

| Scenario | Sign | How to sign it | Pattern (T I M R P) | Note |
| --- | --- | --- | --- | --- |
| Coffee shop | Water | W shape taps chin | 1 0 0 0 1 |  |
| Coffee shop | Numbers 1–3 | Hold up 1, 2 or 3 fingers | see shapes table | For quantity |
| Coffee shop | One coffee, please | Number 1 sign | 1 0 1 1 1 | "Coffee" is two-handed in ASL (grinding motion) |
| Library | Shh / Quiet | Index finger on lips, pointing up\* | 1 0 1 1 1 |  |
| Library | Library | L shape moving in a small circle | 0 0 1 1 1 |  |
| Library | Where | Index finger wags side to side | 1 0 1 1 1 | "Book" is two-handed, skip it |
| Airport | Airplane | Thumb, index, pinky out, palm down, hand moves forward | 0 0 1 1 0 | Same shape as I love you; palm-down tilt separates them |
| Airport | Phone / Call | Y shape held at the ear | 0 1 1 1 0 |  |
| Airport | Where / Water / Washroom | See other rows | — |  |
| Lift / elevator | Up / Down | Index pointing up or down | 1 0 1 1 1 | Accelerometer tilt separates them; great MPU demo |
| Lift / elevator | Floor numbers 1–5 | Hold up 1–5 fingers | see shapes table |  |
| Lift / elevator | Hold the door / Wait | Flat hand, palm facing out\* | 1 0 0 0 0 | Universal stop gesture |
| Classroom | I have a question | Raise index finger\* | 1 0 1 1 1 |  |
| Classroom | May I go to the washroom? | Raise pinky\* | 1 1 1 1 0 | Common gesture in Indian schools |
| Classroom | Understand | Fist at forehead, index flicks up | ends 1 0 1 1 1 | Ends as index-only shape |
| Supermarket | Where is…? | Index wag | 1 0 1 1 1 |  |
| Supermarket | Numbers 1–5 | Hold up 1–5 fingers | see shapes table | For how many |
| Supermarket | This one | Point with index, palm down\* | 1 0 1 1 1 | "How much" and "Pay" are two-handed |
| Restaurant | Table for two | Number 2 sign | 1 0 0 1 1 |  |
| Restaurant | Water | W shape taps chin | 1 0 0 0 1 |  |
| Restaurant | Delicious | Middle finger touches lips, then hand twists outward | 0 0 1 0 0 | Bending only the middle finger is hard for some people |
| Restaurant | Good | Thumbs up\* | 0 1 1 1 1 |  |

"Eat" and "Drink" use half-bent fingers. The current code only knows bent or straight, so skip them for now.

## Signs to avoid

These are two-handed in ASL, so a one-glove setup can't capture them: Excuse me, Coffee, Help, Book, Pay, How much, Stop, More, Menu, Ticket.

## Fixing the current 5 phrases

The current set has two clashes:

- **HELLO and THANK YOU** both use the flat hand (1 0 0 0 0), so the bent/straight code can't tell them apart.
- **NO** is a moving sign, so it has no single fixed finger pattern.

This set works with the current code unchanged, since every pattern is different:

| Phrase | Hand shape | Pattern (T I M R P) |
| --- | --- | --- |
| HELLO | Flat hand, thumb tucked | 1 0 0 0 0 |
| YES | Fist | 1 1 1 1 1 |
| OKAY | Thumbs up | 0 1 1 1 1 |
| I LOVE YOU | Thumb, index, pinky out | 0 0 1 1 0 |
| WATER | W shape | 1 0 0 0 1 |

## Scenario mode

Let the user pick a scenario on the website, so the same hand shape means a different phrase in each place. With only about 12 reliable shapes, this keeps the number of trained shapes small and recognition more reliable.

| Hand shape | Lift | Classroom | Restaurant |
| --- | --- | --- | --- |
| Index only, pointing up | Going up, please | I have a question | One minute, please |
| Pinky only | — | May I go to the washroom? | Where is the washroom? |
| Index + middle | 2nd floor, please | — | Table for two |
| Flat hand, palm out | Hold the door | — | Hello |
| Thumbs up | Okay | I understand | The food is good |

Be upfront with evaluators that in scenario mode some outputs are full phrases built from simple signs, not exact sign-language translations. Supporting Up vs Down and Hello vs Thank you needs the ESP32 code to use MPU tilt as well.
```

In VS Code, use the Markdown preview to view the tables.
