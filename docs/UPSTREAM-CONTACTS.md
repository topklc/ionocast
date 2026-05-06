# Upstream-source contacts

Audit trail of correspondence with the operators of the data sources
used by ionocast (see `licenses.html` for the source list).

The purpose of this file is transparency: anyone reviewing whether
ionocast's licensing posture is reasonable can see which upstream
operators have been contacted, what was asked, and what they replied.
This is the audit trail referred to from `licenses.html` (Voluntary
donations subsection of the Commercial-use ban).

## Policy

- ionocast does not proactively email every upstream source. Most
  sources are public-domain (NOAA, NASA) or have widely-accepted CC
  / CC-NC licenses where voluntary donations are not commercial use
  under the standard interpretation. Mass outreach would be
  bureaucratic gatekeeping for what is the open-source / hobby norm.
- ionocast does proactively contact upstream operators whose license
  language is unusually strict (e.g. "personal hobby use only"), or
  who have a documented history of contacting downstream operators.
- If an operator objects to ionocast's use, the response is to drop
  the affected panel, not the donate link. See `licenses.html`
  Commercial-use ban → Voluntary donations.
- Replies are recorded verbatim where short; summarised + linked
  where long. The date of contact and the date of reply are both
  recorded.

## Contacts

### William R. Hepburn (`dxinfocentre.com`)

**Source:** previously §11 of `licenses.html` (tropospheric ducting
forecast maps, used in the VHF section; 8 regional images).

**Reason for contact:** the license text is "personal hobby use
only" (per the dxinfocentre.com page text), which is stricter than
the CC-NC sources above. Hepburn has historically contacted
downstream operators directly when he objects to a use; pre-emptive
ask was the conservative move.

**Question asked:** does an unsolicited Ko-fi tip jar in the footer
fall within "personal hobby use only," given that no content is
gated behind a donation, no rewards are offered, and every visitor
sees every panel for free regardless of whether they donate?

**Reply (verbatim):**

> Hi Toprak,
>
> Thank you for your e-mail.
>
> I understand your desire to provide the ham community with a
> website, but I do not allow any posting of my forecast maps on
> other websites. The reasoning is simple, if I allow it for one
> site, then many more sites will request the same thing. This
> would end up drawing traffic away from my site and lower ad
> revenues, which partially fund the operation.
>
> The forecasts have been provided for free to the ham community
> for 26 years now, and I would like to continue to do that. I have
> tried so far to not have to put them behind a paywall.
>
> I kindly request that you please remove our forecast maps from
> your website. Thank you for your co-operation and understanding.
>
> Regards,
> William R. Hepburn
> DX Info Centre

**Reply summary:** declined. The objection is to embedding /
re-hosting on third-party sites at all (any embed shifts traffic
away from `dxinfocentre.com` and reduces the ad revenue that funds
the maps); it is not specifically a non-commercial / Ko-fi
objection. The donate-link question was not addressed. No
precedent is set re: the NC interpretation in `licenses.html`.

**Action taken (2026-04-28):** the tropospheric ducting panel,
captions, attribution entry, and `dxinfocentre.com` preconnect
were removed from the site. Section 11 of `licenses.html` was
deleted and subsequent sections renumbered. The `MAINTENANCE.md`
entries for the Hepburn grid were dropped. No further use of
`dxinfocentre.com` content remains.

---

## Sources not proactively contacted

The following sources have not been emailed about the Ko-fi link.
The reasoning, per source, is documented inline.

| Source | License posture | Why not contacted |
|---|---|---|
| NOAA SWPC | Public domain (17 USC §105) | No commercial restriction; nothing to ask. |
| NASA CCMC DONKI | Public domain | Same. |
| NASA SDO | Not copyrighted unless noted | Same. |
| GFZ Potsdam | CC-BY 4.0 | Permits commercial use; donations are unambiguously non-commercial. |
| University of Wyoming | No ToS | Public university research service; no license to ask about. |
| IMO meteor calendar | No formal redistribution license | Observational facts; not copyrightable on their own. |
| KC2G (Andrew Rodland) | CC-BY-NC-SA flow-through from GIRO | CC-NC; voluntary donations are non-commercial under CC's own NC FAQ. |
| GIRO / Lowell DIDBase | CC-BY-NC-SA 4.0 | Same. |
| SIDC SILSO | CC-BY-NC 4.0 | Same. |
| WDC Kyoto | "no commercial applications" | Voluntary donations are not a "commercial application" of the Dst index data. |
| wspr.live | "free of charge for everyone" | Every panel remains free of charge for every visitor; the clause is about access, not about whether the operator can accept tips. |

If any of these operators contacts ionocast and objects, the entry
above moves into the **Contacts** section with the correspondence
recorded, and the action follows the policy: drop the affected panel.
