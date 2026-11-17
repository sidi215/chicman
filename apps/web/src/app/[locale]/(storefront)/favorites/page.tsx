import { permanentRedirect } from "next/navigation"

/** Favorites moved into the buyer dashboard; old links and bookmarks still arrive. */
export default function FavoritesRedirect() {
  permanentRedirect("/account/favorites")
}
