import net from "node:net";

/**
 * Decides whether an IP address may be reached by the tools of a public server. Anything that is not
 * ordinary global unicast is refused: loopback, link-local (the cloud metadata service lives in
 * 169.254.169.254), private ranges, carrier-grade NAT, documentation, multicast and reserved blocks,
 * plus every IPv6 form that embeds one of those IPv4 addresses (mapped, NAT64, 6to4).
 */

type Octets = readonly [number, number, number, number];

function parseIPv4(address: string): Octets | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !(octet >= 0 && octet <= 255))) return undefined;
  return octets as unknown as Octets;
}

/** Expands an IPv6 literal into its eight 16-bit groups (an IPv4 tail counts as two groups). */
function parseIPv6(input: string): number[] | undefined {
  const address = input.split("%")[0] ?? "";
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = parseIPv4(tail);
    if (!octets) return undefined;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const toGroups = (side: string): number[] | undefined => {
    if (side === "") return [];
    const groups = side
      .split(":")
      .map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : Number.NaN));
    return groups.some(Number.isNaN) ? undefined : groups;
  };
  const head = toGroups(halves[0] ?? "");
  if (!head) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const rest = toGroups(halves[1] ?? "");
  if (!rest || head.length + rest.length > 7) return undefined;
  return [...head, ...new Array<number>(8 - head.length - rest.length).fill(0), ...rest];
}

function isBlockedIPv4([a, b, c]: Octets): boolean {
  return (
    a === 0 || // "this network", 0.0.0.0
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol / documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved and broadcast
  );
}

function embeddedIPv4(high: number, low: number): Octets {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isBlockedIPv6(groups: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  // ::ffff:a.b.c.d (IPv4-mapped): the IPv4 rules decide.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedIPv4(embeddedIPv4(g6, g7));
  }
  // 64:ff9b::/96 (NAT64): the embedded IPv4 decides. 64:ff9b:1::/48 is local-use.
  if (g0 === 0x64 && g1 === 0xff9b) {
    return g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0
      ? isBlockedIPv4(embeddedIPv4(g6, g7))
      : true;
  }
  // 2002::/16 (6to4) embeds the IPv4 address right after the prefix.
  if (g0 === 0x2002) return isBlockedIPv4(embeddedIPv4(g1, g2));
  // Only global unicast 2000::/3 is left; ::, ::1, fc00::/7, fe80::/10, ff00::/8... are all outside it.
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && (g1 < 0x200 || g1 === 0xdb8)) return true; // Teredo, ORCHID, documentation
  return false;
}

/** True when `address` (an IP literal, no brackets) must not be reached. Unparsable input is blocked. */
export function isBlockedAddress(address: string): boolean {
  const kind = net.isIP(address.split("%")[0] ?? "");
  if (kind === 4) {
    const octets = parseIPv4(address);
    return !octets || isBlockedIPv4(octets);
  }
  if (kind === 6) {
    const groups = parseIPv6(address);
    return !groups || isBlockedIPv6(groups);
  }
  return true;
}
