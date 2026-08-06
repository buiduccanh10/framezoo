const adjectives = [
  'Cool', 'Swift', 'Bright', 'Silent', 'Quick', 'Brave', 'Clever', 'Wise', 'Bold', 'Calm',
  'Wild', 'Free', 'Sharp', 'Soft', 'Hard', 'Light', 'Dark', 'Fast', 'Slow', 'High',
  'Low', 'Deep', 'Shallow', 'Wide', 'Narrow', 'Long', 'Short', 'Big', 'Small', 'Hot',
  'Cold', 'Warm', 'Wet', 'Dry', 'Sweet', 'Sour', 'Bitter', 'Salty', 'Fresh', 'Stale',
  'New', 'Old', 'Young', 'Mature', 'Happy', 'Sad', 'Angry', 'Calm', 'Excited', 'Bored'
];

const nouns = [
  'Eagle', 'Wolf', 'Bear', 'Lion', 'Tiger', 'Shark', 'Falcon', 'Hawk', 'Owl', 'Raven',
  'Fox', 'Cat', 'Dog', 'Horse', 'Deer', 'Rabbit', 'Mouse', 'Bird', 'Fish', 'Snake',
  'Turtle', 'Frog', 'Butterfly', 'Bee', 'Ant', 'Spider', 'Dragon', 'Phoenix', 'Unicorn',
  'Griffin', 'Wizard', 'Knight', 'Warrior', 'Hunter', 'Explorer', 'Adventurer', 'Pirate',
  'Ninja', 'Samurai', 'Ranger', 'Scout', 'Pilot', 'Captain', 'Commander', 'Leader',
  'Hero', 'Champion', 'Master', 'Legend'
];

export function generateRandomNickname(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective} ${noun}`;
}
