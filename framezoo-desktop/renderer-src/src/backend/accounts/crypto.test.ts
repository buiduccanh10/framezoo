import { describe, expect, it } from "vitest";

import { decryptData, encryptData, keysFromSeed, signCode } from "./crypto";

function hexBytes(value: string) {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

describe("account crypto", () => {
  it("keeps Ed25519 seed/key/signature compatibility", async () => {
    const seed = hexBytes(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    );
    const keys = await keysFromSeed(seed);

    expect(Buffer.from(keys.publicKey).toString("hex")).toBe(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    );
    expect(
      Buffer.from(await signCode("", keys.privateKey)).toString("hex"),
    ).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
  });

  it("round-trips the existing AES-GCM storage format", async () => {
    const secret = new Uint8Array(32).fill(7);
    const encrypted = await encryptData("Browser", secret);

    expect(encrypted.split(".")).toHaveLength(3);
    expect(decryptData(encrypted, secret)).toBe("Browser");
  });
});
