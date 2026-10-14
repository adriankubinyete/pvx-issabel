// Package lists of the Issabel 5 install. `$ASTVER` is a literal placeholder, replaced by the chosen Asterisk version.
import type { AddonKey, AsteriskVersion } from "./state.ts";

export const MIRROR_PROBE_URL = "http://mirror.issabel.org";
export const MIN_MEM_KB = 1536 * 1024;
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";
export const DEFAULT_ASTVER: AsteriskVersion = "18";
export const ASTERISK_VERSIONS: AsteriskVersion[] = ["16", "18"];
export const REMI_PHP_STREAM = "php:remi-7.4";

/** Temporary MySQL root password, in place only between `post` and `database`. */
export const TEMP_MYSQL_PASSWORD = "iSsAbEl.2o17";

export const ADDON_PACKAGES: Record<AddonKey, string[]> = {
  licensed: [
    "issabel-license", "webconsole", "issabel-wizard", "issabel-packet_capture",
    "issabel-upnpc", "issabel-two_factor_auth", "issabel-theme_designer", "issabel-network-agent",
  ],
  "community-blocklist": ["issabel-packetbl"],
  wanpipe: ["wanpipe-utils", "wanpipe"],
};
export const ADDON_KEYS: AddonKey[] = ["licensed", "community-blocklist", "wanpipe"];
export const DEFAULT_ADDONS: AddonKey[] = ["licensed", "community-blocklist"];

export const ADDON_LABEL: Record<AddonKey, string> = {
  licensed: "licenciados",
  "community-blocklist": "blocklist",
  wanpipe: "wanpipe",
};

export const PACKAGES_BASE = [
  "httpd", "httpd-tools", "mariadb", "mariadb-connector-c", "mariadb-connector-odbc",
  "mariadb-server", "php", "php-bcmath", "php-cli", "php-common", "php-gd",
  "php-IDNA_Convert", "php-imap", "php-jpgraph", "php-magpierss", "php-mbstring",
  "php-mcrypt", "php-mysqlnd", "php-pdo", "php-pear", "php-pear-DB", "php-PHPMailer",
  "php-process", "php-simplepie", "php-Smarty", "php-soap", "php-tcpdf", "php-tidy",
  "php-xml", "asterisk$ASTVER", "asterisk$ASTVER-devel", "asterisk$ASTVER-curl",
  "asterisk-codec-g729", "asterisk-perl", "asterisk-es-sounds", "asterisk-fr-sounds",
  "asterisk-sounds-en-gsm", "asterisk-pt_BR-sounds", "certbot", "vim", "jq", "whois", "sngrep",
  "bind-utils", "dhcp-server", "langpacks-es", "langpacks-en", "langpacks-pt",
  "langpacks-pt_BR", "langpacks-fa", "langpacks-fr", "mailx",
];

export const PACKAGES_ISSABEL = [
  "issabel-geoip", "issabel", "issabel-prosody-auth", "issabel-endpointconfig2",
  "xtables-addons", "RoundCubeMail", "php-ioncubeloader", "libnsl", "fop2",
];

export const basePackages = (astver: AsteriskVersion): string[] => PACKAGES_BASE.map((name) => name.replace("$ASTVER", astver));
export const addonPackages = (keys: AddonKey[]): string[] => keys.flatMap((key) => ADDON_PACKAGES[key]);
