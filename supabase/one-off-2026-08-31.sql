-- Two one-off statements. Not part of schema.sql, because neither should run
-- a second time and schema.sql is written to be re-runnable from nothing.
-- Run these AFTER schema.sql.

-- 1. Remove the row I created while proving the RSVP works. It is the only
--    row in the table, and it is mine, not a supporter's.
delete from meeting_rsvps where device_key = 'claude-verify-delete-me';

-- 2. Optional, and your words rather than mine, so change or skip it.
--    The note now repeats the page: the doors time and the finish are in the
--    running order, free-with-a-bucket is in the facts panel, and the stream
--    has its own row. What is left is the part only you can say.
update meetings
   set note =
     'The point of it is an open, honest conversation about Kettering Town, and ' ||
     'building something that is genuinely fans for fans, run by fans. If you ' ||
     'would like to speak rather than just ask a question, message us beforehand ' ||
     'and we will get you on the agenda. We are hoping to have No. 1 Smash & ' ||
     'Grab there on the night, pay as you eat.'
 where title = 'The first supporters meeting';
