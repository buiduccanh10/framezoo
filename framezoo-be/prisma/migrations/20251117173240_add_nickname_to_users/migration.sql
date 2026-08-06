-- Add nickname column to users table
ALTER TABLE "users" ADD COLUMN "nickname" VARCHAR(255) NOT NULL DEFAULT '';

-- Generate random nicknames for existing users
UPDATE "users" SET "nickname" = (
  SELECT
    adj || ' ' || noun
  FROM (
    SELECT
      unnest(ARRAY['Cool', 'Swift', 'Bright', 'Silent', 'Quick', 'Brave', 'Clever', 'Wise', 'Bold', 'Calm', 'Wild', 'Free', 'Sharp', 'Soft', 'Hard', 'Light', 'Dark', 'Fast', 'Slow', 'High', 'Low', 'Deep', 'Shallow', 'Wide', 'Narrow', 'Long', 'Short', 'Big', 'Small', 'Hot', 'Cold', 'Warm', 'Wet', 'Dry', 'Sweet', 'Sour', 'Bitter', 'Salty', 'Fresh', 'Stale', 'New', 'Old', 'Young', 'Mature', 'Happy', 'Sad', 'Angry', 'Calm', 'Excited', 'Bored']) AS adj,
      unnest(ARRAY['Eagle', 'Wolf', 'Bear', 'Lion', 'Tiger', 'Shark', 'Falcon', 'Hawk', 'Owl', 'Raven', 'Fox', 'Cat', 'Dog', 'Horse', 'Deer', 'Rabbit', 'Mouse', 'Bird', 'Fish', 'Snake', 'Turtle', 'Frog', 'Butterfly', 'Bee', 'Ant', 'Spider', 'Dragon', 'Phoenix', 'Unicorn', 'Griffin', 'Wizard', 'Knight', 'Warrior', 'Hunter', 'Explorer', 'Adventurer', 'Pirate', 'Ninja', 'Samurai', 'Ranger', 'Scout', 'Pilot', 'Captain', 'Commander', 'Leader', 'Hero', 'Champion', 'Master', 'Legend']) AS noun
    ORDER BY random()
    LIMIT 1
  ) AS random_nick
);
