export const POSTING_TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${hours.toString().padStart(2, "0")}:${minutes}`;
});

const POSTING_TIME_PATTERN = /^([01]\d|2[0-3]):(00|30)$/;

export function getDefaultPostingTimes(postsPerDay: number): string[] {
  if (postsPerDay <= 1) return ["12:00"];
  if (postsPerDay === 2) return ["12:00", "18:00"];
  return ["12:00", "18:00", "00:00"];
}

export function normalizePostsPerDay(input: unknown): number {
  const postsPerDay = Number(input);

  if (!Number.isInteger(postsPerDay) || postsPerDay < 1 || postsPerDay > 3) {
    throw new Error("Posts per day must be between 1 and 3");
  }

  return postsPerDay;
}

export function getCurrentPostingSlot(date = new Date()) {
  const slotDate = new Date(date);
  slotDate.setSeconds(0, 0);
  slotDate.setMinutes(slotDate.getMinutes() < 30 ? 0 : 30);

  const postingSlotDate = [
    slotDate.getFullYear(),
    (slotDate.getMonth() + 1).toString().padStart(2, "0"),
    slotDate.getDate().toString().padStart(2, "0")
  ].join("-");

  const postingSlotTime = [
    slotDate.getHours().toString().padStart(2, "0"),
    slotDate.getMinutes().toString().padStart(2, "0")
  ].join(":");

  return { postingSlotDate, postingSlotTime };
}

export function normalizePostingTimes(input: unknown, postsPerDay: number): string[] {
  const maxPostsPerDay = Math.min(Math.max(Number(postsPerDay) || 1, 1), 3);

  if (input === undefined || input === null) {
    return getDefaultPostingTimes(maxPostsPerDay);
  }

  let rawTimes = input;
  if (typeof input === "string") {
    try {
      rawTimes = JSON.parse(input);
    } catch {
      rawTimes = input.split(",");
    }
  }

  if (!Array.isArray(rawTimes)) {
    throw new Error("Posting times must be an array");
  }

  const uniqueTimes = Array.from(new Set(rawTimes.map((time) => String(time).trim())));

  if (uniqueTimes.length < 1) {
    throw new Error("Select at least 1 posting time");
  }

  if (uniqueTimes.length > 3) {
    throw new Error("Select no more than 3 posting times");
  }

  if (uniqueTimes.length > maxPostsPerDay) {
    throw new Error("Posting times cannot exceed posts per day");
  }

  const invalidTime = uniqueTimes.find((time) => !POSTING_TIME_PATTERN.test(time));
  if (invalidTime) {
    throw new Error("Posting times must use 30-minute intervals");
  }

  return uniqueTimes.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
