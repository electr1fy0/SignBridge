// Phrase library: generic everyday phrases + scenario-based communication. Pure data.
// `sign` marks a phrase the CURRENT firmware can recognise from the glove; every
// other phrase is screen-only (tapped in the web app) or a future firmware extension.

export const GENERIC = [
  { text: 'Okay', sign: 'OKAY', replies: ['Great!', 'Okay, got it.', 'Anything else?'] },
  { text: 'Hello', sign: 'HELLO', replies: ['Hello!', 'How are you?', 'Nice to meet you!', 'What do you need?'] },
  { text: 'Goodbye', sign: 'BYE', replies: ['Goodbye!', 'See you later!', 'Take care!'] },
  { text: 'Thank you', sign: 'THANK YOU', replies: ["You're welcome!", 'Happy to help.', 'Anytime!'] },
  { text: 'Please', sign: 'PLEASE', replies: ['Of course.', 'What do you need?'] },
  { text: 'Yes', replies: ['Okay, got it.', 'Great!'] },
  { text: 'No', replies: ['Okay, no problem.', 'What would you like instead?'] },
  { text: 'Excuse me', replies: ['Yes?', 'How can I help?'] },
  { text: 'Sorry', replies: ["It's okay.", 'No problem.'] },
  { text: 'Help me', replies: ["I'm coming.", 'What happened?', "I'll call someone."] },
  { text: 'I need water', sign: 'WATER', replies: ["I'll get you some water.", 'Here you go!'] },
  { text: 'I need food', replies: ["I'll get you something.", 'What would you like?'] },
  { text: 'I am tired', replies: ['Do you want to rest?', 'Shall we take a break?'] },
  { text: 'I am in pain', replies: ['Where does it hurt?', "I'll get a doctor.", 'Do you need medicine?'] },
  { text: 'I need assistance', replies: ["I'm coming.", 'What do you need?'] },
  { text: 'Wait', replies: ["Okay, I'll wait.", 'Take your time.'] },
  { text: 'Come here', sign: 'COME HERE', replies: ['Coming!', 'Give me a minute'] },
  { text: 'Slow down', sign: 'SLOW DOWN', replies: ["Sorry, I'll slow down.", 'Should I repeat that?'] },
  { text: 'I am finished', sign: 'FINISHED', replies: ['Great job!', 'Anything else?'] },
  { text: "I don't understand", replies: ['Let me repeat.', "I'll write it down.", 'Let me show you.'] },
];

export const SCENARIOS = [
  {
    id: 'cafe',
    name: 'Cafe / Coffee shop',
    phrases: [
      { text: 'I want coffee.', replies: ['What kind of coffee?', 'Hot or iced?', 'Coming right up!'] },
      { text: 'The coffee is cold.', replies: ["I'll heat it for you.", 'Would you like another coffee?', 'Is it too cold to drink?'] },
      { text: 'I need water.', sign: 'WATER', replies: ["I'll get you some water.", 'Here you go!'] },
      { text: 'I want the bill.', replies: ["I'll bring the bill.", 'Card or cash?'] },
      { text: 'No sugar, please.', replies: ['No sugar, got it.', 'Any milk?'] },
      { text: 'Thank you.', sign: 'THANK YOU', replies: ["You're welcome!", 'Enjoy your coffee!'] },
    ],
  },
  {
    id: 'restaurant',
    name: 'Restaurant',
    phrases: [
      { text: 'I want to see the menu.', replies: ["Here's the menu.", 'One moment, please.'] },
      { text: 'I am hungry.', replies: ['What would you like to eat?', "I'll get the menu."] },
      { text: 'I need water.', sign: 'WATER', replies: ["I'll get you some water.", 'Still or sparkling?'] },
      { text: 'This food is too hot.', replies: ['Let it cool a little.', 'Would you like cold water?'] },
      { text: 'I need a spoon.', replies: ["I'll bring a spoon.", 'Here you go!'] },
      { text: 'Please call the waiter.', replies: ["I'll call the waiter.", 'The waiter is coming.'] },
      { text: 'The bill, please.', replies: ["I'll bring the bill.", 'Card or cash?'] },
    ],
  },
  {
    id: 'classroom',
    name: 'Classroom / College',
    phrases: [
      { text: "I don't understand.", replies: ['Let me explain again.', "I'll write it down.", 'Which part?'] },
      { text: 'Please repeat that.', replies: ["Sure, I'll repeat it.", "I'll write it on the board."] },
      { text: 'I have a question.', replies: ['Go ahead.', 'Please write it down.'] },
      { text: 'Can you help me?', replies: ['Yes, of course.', 'Give me a minute'] },
      { text: 'I need to leave.', replies: ['Okay, you may go.', 'Is everything okay?'] },
      { text: 'Thank you, teacher.', sign: 'THANK YOU', replies: ["You're welcome!", 'Good work today.'] },
    ],
  },
  {
    id: 'travel',
    name: 'Train station / Airport',
    phrases: [
      { text: 'Where is the platform?', replies: ['Platform 2, on the left.', "I'll show you.", 'Which train?'] },
      { text: 'Where is the gate?', replies: ["I'll show you.", 'Can I see your ticket?'] },
      { text: 'I need help.', replies: ['How can I help?', "I'll find staff."] },
      { text: 'Where is the restroom?', replies: ["It's straight ahead.", "I'll show you."] },
      { text: 'I need a ticket.', replies: ['The ticket counter is there.', 'Where are you going?'] },
      { text: 'I am lost.', replies: ["Don't worry, I'll help.", 'Where are you going?'] },
      { text: 'Please help me find my train.', replies: ['Which train?', 'Can I see your ticket?', "I'll show you."] },
    ],
  },
  {
    id: 'hospital',
    name: 'Hospital / Emergency',
    phrases: [
      { text: 'I need a doctor.', replies: ["I'll call a doctor.", 'The doctor is coming.', 'Is it urgent?'] },
      { text: 'I am in pain.', replies: ['Where does it hurt?', "I'll call the doctor now.", 'Is it urgent?'] },
      { text: 'I need water.', sign: 'WATER', replies: ["I'll get you some water.", 'Here you go!'] },
      { text: 'Please call for help.', replies: ['Calling for help now.', 'Help is coming.'] },
      { text: 'I need assistance.', replies: ["I'm coming.", 'What do you need?'] },
    ],
  },
];

/** Flat list for search: [{text, sign?, replies, scenario}] */
export function allPhrases() {
  return [
    ...GENERIC.map((p) => ({ ...p, scenario: 'Everyday' })),
    ...SCENARIOS.flatMap((s) => s.phrases.map((p) => ({ ...p, scenario: s.name }))),
  ];
}

export function findPhrase(text) {
  const t = String(text).trim().toLowerCase();
  return allPhrases().find((p) => p.text.toLowerCase() === t) ?? null;
}
