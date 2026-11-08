import type { VerifiedIdentity } from "../modules/auth/token-verifier.js";
import type { OwnedShop } from "../modules/shops/shop-access.repository.js";
import type { AppUser } from "../modules/users/user.repository.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate`: the verified token identity. */
      auth?: VerifiedIdentity;
      /** Set by `authenticate`: the verified raw access token. Never logged. */
      accessToken?: string;
      /** Set by `loadAppUser`: the application user, or `null` before bootstrap. */
      appUser?: AppUser | null;
      /** Set by `requireApprovedSeller`: the user's own approved shop. */
      sellerShop?: OwnedShop;
      /** Set by `requireOwnedShop`: the user's own shop, in any status. */
      ownedShop?: OwnedShop;
    }
  }
}

export {};
