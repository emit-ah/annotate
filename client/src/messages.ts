// What the mode says, in English. An app gives other words, such as another language's, through
// `configure({messages})`: plain texts in which `{name}` stands for a value, so any language can give them as JSON.

/** Every text of the mode by its key. */
export const ENGLISH = {
  started: 'Annotation mode on',
  ended: 'Annotation mode off',
  mode: 'Annotating',
  hint: 'Click an element or drag for a region; by keyboard, Tab or the arrow keys pick and Enter annotates',
  cornerFirst: "Click the region's first corner",
  cornerSecond: 'Click its opposite corner',
  focused: 'Focused: {target}',
  target: '{role} · {name}',
  pinFocused: 'Annotate',
  keyEnter: 'Enter',
  keyEscape: 'Esc',
  keySave: 'Ctrl Enter',
  keySaveMac: '⌘ Enter',
  shared: 'Tab shared',
  unshared: 'Without pictures',
  regionButton: 'Region',
  onPage: 'On this page: {count}',
  done: 'Done',
  looking: 'Looking for the annotation service…',
  shareTitle: 'Share this tab?',
  shareText:
    'Each annotation then keeps exactly what you saw. Only this tab, only while you annotate; the browser asks next.',
  without: 'Without pictures',
  share: 'Share this tab',
  sharing: 'The tab is shared while you annotate.',
  notShared: 'The tab is not shared, so your annotations go without pictures.',
  notTheTab: 'Only a tab can be shared, so your annotations go without pictures.',
  unsharedNow: 'The tab is no longer shared; your annotations go without pictures.',
  withoutPictures: 'Your annotations go without pictures.',
  unableTitle: 'Nothing can be kept here',
  noService: 'No annotation service answers here, so the mode keeps nothing.',
  notNow: 'The annotation service does not answer right now. Try again later.',
  noVersion: 'This build does not name its version, which each annotation keeps.',
  noApp: 'This page does not name its app, which each annotation keeps.',
  leave: 'Leave',
  comment: 'Comment',
  cancel: 'Cancel',
  save: 'Save',
  crop: 'What you saw around it, from the shared tab',
  regionLabel: 'Region',
  region: 'Region · {count} elements',
  regionOn: 'Region on {page}',
  named: '“{name}”',
  private: 'This part of the app is not annotated.',
  empty: 'Write a comment first.',
  saved: 'Saved.',
  waits: 'Kept in this browser; it goes to the annotation service when the mode next finds it.',
  refused: 'Not saved: {reason}',
  denied: 'Not saved: the app keeps no annotation of this.',
  notKept: 'Not saved: the annotation service does not answer, and this browser keeps nothing for later.',
  list: 'Annotations',
  listTitle: 'This page · {count}',
  listEmpty: 'No annotations on this page yet.',
  pin: 'Annotation {number}',
  statusOpen: 'Open',
  statusInProgress: 'In progress',
  statusDone: 'Done',
  statusDoneIn: 'Done in {version}',
  statusWontDo: "Won't do",
  statusWaiting: 'Waiting to be sent',
  answer: 'Claude: {answer}',
  by: '{author}, {time} UTC',
  version: '{app} {version}',
} as const;

/** The key of a text. */
export type MessageKey = keyof typeof ENGLISH;

/** Every text of the mode by its key. */
export type Messages = Record<MessageKey, string>;

/** The values a text's `{name}` placeholders stand for. */
export type Values = Readonly<Record<string, string | number>>;

/** The texts `own` over the English ones: those of the right keys that are texts. */
export function messagesWith(own: Partial<Record<string, unknown>>): Messages {
  const messages: Messages = { ...ENGLISH };
  for (const key of Object.keys(ENGLISH).filter((name): name is MessageKey => name in ENGLISH)) {
    const text = own[key];
    if (typeof text === 'string' && text !== '') {
      messages[key] = text;
    }
  }
  return messages;
}

/** The text `key` of `messages`, with its placeholders replaced by `values`; a placeholder without one stays. */
export function say(messages: Messages, key: MessageKey, values: Values = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
