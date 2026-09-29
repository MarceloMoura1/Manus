export type AttendanceLaunchIntent = {
  activeToken: number;
  nextToken: number;
  phone: string;
};

export function createAttendanceLaunchIntent(open: boolean, phone = ""): AttendanceLaunchIntent {
  return {
    activeToken: open ? 1 : 0,
    nextToken: open ? 1 : 0,
    phone: open ? phone : "",
  };
}

export function queueAttendanceLaunchIntent(
  current: AttendanceLaunchIntent,
  phone = current.phone,
): AttendanceLaunchIntent {
  const token = current.nextToken + 1;
  return { activeToken: token, nextToken: token, phone };
}

export function consumeAttendanceLaunchIntent(
  current: AttendanceLaunchIntent,
  token: number,
): AttendanceLaunchIntent {
  if (!token || current.activeToken !== token) return current;
  return { ...current, activeToken: 0, phone: "" };
}
