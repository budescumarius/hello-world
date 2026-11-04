<?php
// PILOTAGE – boîtes hébergées (Hostico / cPanel) : client IMAP minimal (lecture, copie dans « Envoyés »), vérification SMTP,
// et lecture des e-mails au format MIME (texte, encodages, pièces jointes). Sans extension PHP « imap » (absente de nombreux hébergements).
declare(strict_types=1);

final class PilImap {
    /** @var resource */
    private $fp;
    private int $n = 0;
    public function __construct(string $host, int $port, string $sec) {
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
        $fp = @stream_socket_client(($sec === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) throw new PilError("Serveur de réception (IMAP) injoignable ($host:$port) : " . ($errstr ?: 'connexion refusée'), 502);
        stream_set_timeout($fp, 40);
        $this->fp = $fp;
        $g = $this->line(); if (!str_starts_with($g, '* OK')) throw new PilError('Serveur IMAP : ' . $g, 502);
        if ($sec === 'tls') {
            [$st] = $this->cmd('STARTTLS'); if ($st !== 'OK') throw new PilError('Le serveur IMAP refuse le chiffrement (STARTTLS).', 502);
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new PilError('Échec du chiffrement TLS (IMAP).', 502);
        }
    }
    public function __destruct() { if (is_resource($this->fp)) { @fwrite($this->fp, 'Z LOGOUT' . "\r\n"); @fclose($this->fp); } }
    private function line(): string {
        $l = fgets($this->fp, 65536);
        if ($l === false) throw new PilError('Connexion IMAP interrompue.', 502);
        return rtrim($l, "\r\n");
    }
    public static function q(string $s): string { return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"'; }
    /**
     * Commande IMAP. Réponses non marquées : [['t' => texte (littéraux remplacés par {Ln}), 'lits' => [contenu…]], …].
     * $literal : contenu envoyé après la demande de suite « + » (APPEND).
     */
    public function cmd(string $c, ?string $literal = null): array {
        $tag = 'A' . (++$this->n);
        fwrite($this->fp, "$tag $c\r\n");
        $out = []; $cur = null;
        while (true) {
            $l = $this->line();
            if ($literal !== null && str_starts_with($l, '+')) { fwrite($this->fp, $literal . "\r\n"); $literal = null; continue; }
            if (str_starts_with($l, "$tag ")) { if ($cur) $out[] = $cur; $p = explode(' ', $l, 3); return [strtoupper($p[1] ?? ''), $out, $p[2] ?? '']; }
            if ($cur === null || str_starts_with($l, '* ')) { if ($cur) $out[] = $cur; $cur = ['t' => '', 'lits' => []]; }
            // littéral {N} en fin de ligne : on lit N octets, puis la suite de la même réponse
            while (preg_match('/\{(\d+)\}$/', $l, $m)) {
                $cur['t'] .= substr($l, 0, -strlen($m[0])) . '{L' . count($cur['lits']) . '}';
                $len = (int)$m[1]; $data = '';
                while (strlen($data) < $len) { $chunk = fread($this->fp, min(65536, $len - strlen($data))); if ($chunk === false || $chunk === '') throw new PilError('Connexion IMAP interrompue (lecture).', 502); $data .= $chunk; }
                $cur['lits'][] = $data;
                $l = $this->line();
            }
            $cur['t'] .= $l;
        }
    }
    public function login(string $user, string $pass): void {
        [$st, , $msg] = $this->cmd('LOGIN ' . self::q($user) . ' ' . self::q($pass));
        if ($st !== 'OK') throw new PilError('Adresse ou mot de passe refusé par le serveur de messagerie' . ($msg ? " ($msg)" : '') . '.', 401);
    }
    /** Dossier des messages envoyés (attribut \Sent, sinon par son nom). */
    public function sentFolder(): ?string {
        [, $r] = $this->cmd('LIST "" "*"');
        $byName = null;
        foreach ($r as $x) {
            if (!preg_match('/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\\\]|\\\\.)*)"|(\S+))$/i', $x['t'], $m)) continue;
            $name = ($m[2] ?? '') !== '' ? stripcslashes($m[2]) : ($m[3] ?? '');
            if (preg_match('/\\\\Sent\b/i', $m[1])) return $name;
            if (!$byName && preg_match('/(^|[.\/])(sent|sent items|sent messages|envoy|éléments envoyés|verzonden)/iu', $name)) $byName = $name;
        }
        return $byName;
    }
    /** Ouvre un dossier en lecture seule ; renvoie son UIDVALIDITY. */
    public function examine(string $folder): int {
        [$st, $r] = $this->cmd('EXAMINE ' . self::q($folder));
        if ($st !== 'OK') throw new PilError("Dossier « $folder » introuvable sur le serveur.", 502);
        foreach ($r as $x) if (preg_match('/UIDVALIDITY (\d+)/i', $x['t'], $m)) return (int)$m[1];
        return 0;
    }
    /** @return int[] UID des messages reçus depuis la date (AAAA-MM-JJ). */
    public function since(string $date): array {
        [$st, $r] = $this->cmd('UID SEARCH SINCE ' . date('d-M-Y', strtotime($date)));
        if ($st !== 'OK') return [];
        $u = []; foreach ($r as $x) if (preg_match('/^\* SEARCH ?(.*)$/i', $x['t'], $m)) foreach (preg_split('/\s+/', trim($m[1])) as $v) if ($v !== '') $u[] = (int)$v;
        return $u;
    }
    /** @return array<int, array{uid:int, flags:string, date:?string, size:int, raw:?string}> */
    public function fetch(array $uids, bool $full, int $maxSize = 12 * 1024 * 1024): array {
        if (!$uids) return [];
        $set = implode(',', $uids);
        [, $r] = $this->cmd("UID FETCH $set (UID FLAGS INTERNALDATE RFC822.SIZE)");
        $meta = [];
        foreach ($r as $x) if (preg_match('/UID (\d+)/i', $x['t'], $m)) {
            $meta[(int)$m[1]] = ['uid' => (int)$m[1], 'flags' => preg_match('/FLAGS \(([^)]*)\)/i', $x['t'], $f) ? $f[1] : '',
                'date' => preg_match('/INTERNALDATE "([^"]+)"/i', $x['t'], $d) ? date('Y-m-d H:i:s', strtotime($d[1])) : null, 'size' => preg_match('/RFC822\.SIZE (\d+)/i', $x['t'], $s) ? (int)$s[1] : 0, 'raw' => null];
        }
        foreach ($meta as $uid => $mm) {
            $part = $full && $mm['size'] <= $maxSize ? 'BODY.PEEK[]' : 'BODY.PEEK[HEADER]';
            [, $rr] = $this->cmd("UID FETCH $uid ($part)");
            foreach ($rr as $x) if ($x['lits']) { $meta[$uid]['raw'] = $x['lits'][0]; break; }
            $meta[$uid]['partial'] = $part !== 'BODY.PEEK[]';
        }
        return $meta;
    }
    public function caps(): array { [, $r] = $this->cmd('CAPABILITY'); $c = []; foreach ($r as $x) if (preg_match('/^\* CAPABILITY (.*)$/i', $x['t'], $m)) foreach (explode(' ', strtoupper($m[1])) as $k) $c[$k] = true; return $c; }
    /** Dossiers : [nom => attributs], et séparateur. */
    public function folders(): array {
        [, $r] = $this->cmd('LIST "" "*"'); $out = []; $delim = '.';
        foreach ($r as $x) if (preg_match('/^\* LIST \(([^)]*)\) (?:"((?:[^"\\\\]|\\\\.)*)"|NIL) (?:"((?:[^"\\\\]|\\\\.)*)"|(\S+))$/i', $x['t'], $m)) { $delim = $m[2] !== '' ? stripcslashes($m[2]) : $delim; $out[($m[3] ?? '') !== '' ? stripcslashes($m[3]) : ($m[4] ?? '')] = $m[1]; }
        return [$out, $delim];
    }
    /** Ouvre un dossier en lecture-écriture ; renvoie son UIDVALIDITY. */
    public function select(string $folder): int {
        [$st, $r] = $this->cmd('SELECT ' . self::q($folder));
        if ($st !== 'OK') throw new PilError("Dossier « $folder » introuvable sur le serveur.", 502);
        foreach ($r as $x) if (preg_match('/UIDVALIDITY (\d+)/i', $x['t'], $m)) return (int)$m[1];
        return 0;
    }
    public function create(string $folder): bool { [$st] = $this->cmd('CREATE ' . self::q($folder)); $this->cmd('SUBSCRIBE ' . self::q($folder)); return $st === 'OK'; }
    /** Déplace un message (MOVE, ou COPY + suppression de ce seul message) ; renvoie [uidvalidity, nouvel UID] si le serveur les donne. */
    public function move(int $uid, string $dest, array $caps): ?array {
        $parse = function (array $r, string $txt) { foreach (array_merge(array_column($r, 't'), [$txt]) as $t) if (preg_match('/COPYUID (\d+) \S+ (\d+)/i', $t, $m)) return [(int)$m[1], (int)$m[2]]; return [0, 0]; };
        if (isset($caps['MOVE'])) { [$st, $r, $txt] = $this->cmd("UID MOVE $uid " . self::q($dest)); return $st === 'OK' ? $parse($r, $txt) : null; }
        if (!isset($caps['UIDPLUS'])) return null; // sans UIDPLUS, on ne supprime rien (EXPUNGE effacerait aussi d'autres messages)
        [$st, $r, $txt] = $this->cmd("UID COPY $uid " . self::q($dest)); if ($st !== 'OK') return null;
        $this->cmd("UID STORE $uid +FLAGS.SILENT (\\Deleted)"); $this->cmd("UID EXPUNGE $uid");
        return $parse($r, $txt);
    }
    public function append(string $folder, string $msg): bool {
        [$st] = $this->cmd('APPEND ' . self::q($folder) . ' (\\Seen) {' . strlen($msg) . '}', $msg);
        return $st === 'OK';
    }
}

/** Vérifie l'envoi (connexion + identification SMTP), sans rien envoyer. */
function pil_smtp_check(array $s, string $user, string $pass): void {
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
    $fp = @stream_socket_client(($s['sec'] === 'ssl' ? 'ssl://' : 'tcp://') . $s['host'] . ':' . $s['port'], $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) throw new PilError("Serveur d'envoi (SMTP) injoignable ({$s['host']}:{$s['port']}) : " . ($errstr ?: 'connexion refusée'), 502);
    stream_set_timeout($fp, 20);
    $read = function () use ($fp) { $all = ''; while (($l = fgets($fp, 1024)) !== false) { $all .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; } return [(int)substr($all, 0, 3), trim($all)]; };
    $cmd = function (string $c) use ($fp, $read) { fwrite($fp, "$c\r\n"); return $read(); };
    try {
        [$c] = $read(); if ($c !== 220) throw new PilError('Serveur SMTP indisponible.', 502);
        [$c] = $cmd('EHLO batipro'); if ($c !== 250) throw new PilError('Serveur SMTP : EHLO refusé.', 502);
        if ($s['sec'] === 'tls') { [$c] = $cmd('STARTTLS'); if ($c !== 220 || !stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new PilError('Échec du chiffrement TLS (SMTP).', 502); $cmd('EHLO batipro'); }
        [$c] = $cmd('AUTH LOGIN'); if ($c !== 334) throw new PilError('Le serveur SMTP refuse l\'identification.', 502);
        $cmd(base64_encode($user)); [$c] = $cmd(base64_encode($pass));
        if ($c !== 235) throw new PilError('Envoi : adresse ou mot de passe refusé par le serveur SMTP.', 401);
        fwrite($fp, "QUIT\r\n");
    } finally { fclose($fp); }
}

// --------------------------------------------------------------------- Lecture MIME
function pil_mime_dec_header(string $v): string {
    if (!str_contains($v, '=?')) return trim(pil_mime_utf8($v, 'UTF-8')); // déjà en clair (souvent UTF-8 brut)
    $v = preg_replace('/\?=\s+=\?/', '?==?', $v); // mots encodés consécutifs : sans l'espace qui les sépare
    $d = function_exists('iconv_mime_decode') ? @iconv_mime_decode($v, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8') : false;
    if ($d === false || $d === '') $d = mb_decode_mimeheader($v);
    return trim(pil_mime_utf8($d, 'UTF-8'));
}
function pil_mime_utf8(string $s, string $cs): string {
    $cs = strtoupper(trim($cs, " \"'")) ?: 'UTF-8';
    if (in_array($cs, ['UTF-8', 'UTF8', 'US-ASCII', 'ASCII'], true)) return mb_check_encoding($s, 'UTF-8') ? $s : mb_convert_encoding($s, 'UTF-8', 'Windows-1252');
    if ($cs === 'ISO-8859-1' || $cs === 'LATIN1') $cs = 'Windows-1252'; // les « ISO-8859-1 » sont presque toujours du Windows-1252
    $r = @mb_convert_encoding($s, 'UTF-8', $cs);
    if (!is_string($r) || $r === '') $r = @iconv($cs, 'UTF-8//IGNORE', $s);
    return is_string($r) ? $r : $s;
}
/** En-têtes (clés en minuscules, valeur brute dépliée) et corps. */
function pil_mime_split(string $raw): array {
    $raw = str_replace("\r\n", "\n", $raw);
    $p = strpos($raw, "\n\n");
    $head = $p === false ? $raw : substr($raw, 0, $p); $body = $p === false ? '' : substr($raw, $p + 2);
    $h = [];
    foreach (preg_split("/\n(?![ \t])/", $head) as $line) {
        if (!str_contains($line, ':')) continue;
        [$k, $v] = explode(':', $line, 2);
        $k = strtolower(trim($k)); $v = trim(preg_replace("/\n[ \t]+/", ' ', $v));
        $h[$k] = isset($h[$k]) && $k === 'received' ? $h[$k] : $v;
    }
    return [$h, $body];
}
function pil_mime_params(string $v): array {
    $parts = preg_split('/;(?=(?:[^"]*"[^"]*")*[^"]*$)/', $v);
    $out = ['_' => strtolower(trim((string)array_shift($parts)))];
    foreach ($parts as $p) {
        if (!str_contains($p, '=')) continue;
        [$k, $val] = explode('=', $p, 2); $k = strtolower(trim($k)); $val = trim(trim($val), '"');
        if (preg_match('/^(.+)\*(\d+)\*?$/', $k, $m)) { $out[$m[1] . '*'] = ($out[$m[1] . '*'] ?? '') . $val; continue; } // RFC 2231 en morceaux
        if (str_ends_with($k, '*')) { $out[$k] = $val; continue; }
        $out[$k] = $val;
    }
    foreach ($out as $k => $val) if (str_ends_with($k, '*') && $k !== '*') {
        $base = substr($k, 0, -1); $cs = 'UTF-8';
        if (preg_match("/^([^']*)'[^']*'(.*)$/", $val, $m)) { $cs = $m[1] ?: 'UTF-8'; $val = $m[2]; }
        $out[$base] = pil_mime_utf8(rawurldecode($val), $cs);
    }
    return $out;
}
function pil_mime_decode_body(string $body, string $enc): string {
    $enc = strtolower(trim($enc));
    if ($enc === 'base64') return (string)base64_decode(preg_replace('/\s+/', '', $body));
    if ($enc === 'quoted-printable') return quoted_printable_decode($body);
    return $body;
}
function pil_html_text(string $html): string {
    $html = preg_replace('#<(script|style|head)[^>]*>.*?</\1>#is', '', $html);
    $html = preg_replace('#<(br|/p|/div|/tr|/li|/h\d)\b[^>]*>#i', "\n", $html);
    $t = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim(preg_replace("/\n\s*\n\s*\n+/", "\n\n", preg_replace('/[ \t\x{00A0}]+/u', ' ', $t)));
}
/**
 * E-mail brut → ['h' => en-têtes, 'from' => [email, nom], 'to' => [[email, nom]…], 'subject', 'date', 'mid', 'refs', 'text', 'atts' => [['name','type','size','data']]].
 */
function pil_mime_parse(string $raw, int $depth = 0): array {
    [$h, $body] = pil_mime_split($raw);
    $res = ['h' => $h, 'text' => '', 'html' => '', 'atts' => []];
    $walk = function (array $h, string $body, int $d) use (&$walk, &$res) {
        $ct = pil_mime_params($h['content-type'] ?? 'text/plain'); $type = $ct['_'] ?: 'text/plain';
        $disp = pil_mime_params($h['content-disposition'] ?? '');
        $name = $disp['filename'] ?? $ct['name'] ?? '';
        if ($name !== '') $name = pil_mime_dec_header($name);
        if (str_starts_with($type, 'multipart/') && !empty($ct['boundary']) && $d < 8) {
            $b = '--' . $ct['boundary'];
            $parts = explode("\n" . $b, "\n" . $body);
            array_shift($parts);
            foreach ($parts as $p) { if (str_starts_with($p, '--')) break; [$ph, $pb] = pil_mime_split(ltrim(substr($p, strcspn($p, "\n") + 1), "")); $walk($ph, $pb, $d + 1); }
            return;
        }
        $data = pil_mime_decode_body($body, $h['content-transfer-encoding'] ?? '');
        $isAtt = ($disp['_'] ?? '') === 'attachment' || ($name !== '' && !str_starts_with($type, 'text/')) || $type === 'message/rfc822' || (!str_starts_with($type, 'text/') && !str_starts_with($type, 'multipart/'));
        if ($isAtt) { if (($disp['_'] ?? '') === 'inline' && str_starts_with($type, 'image/')) return; $res['atts'][] = ['name' => $name ?: 'piece-jointe', 'type' => $type, 'size' => strlen($data), 'data' => $data]; return; }
        $txt = pil_mime_utf8($data, $ct['charset'] ?? 'UTF-8');
        if ($type === 'text/html') { if ($res['html'] === '') $res['html'] = $txt; } elseif ($res['text'] === '') $res['text'] = $txt;
    };
    $walk($h, $body, $depth);
    $addr = function (string $v): array {
        $out = [];
        foreach (preg_split('/,(?=(?:[^"]*"[^"]*")*[^"]*$)/', $v) as $a) {
            $a = trim($a); if ($a === '') continue;
            if (preg_match('/^(.*)<([^>]+)>$/', $a, $m)) $out[] = [mb_strtolower(trim($m[2])), trim(pil_mime_dec_header(trim($m[1])), ' "')];
            elseif (str_contains($a, '@')) $out[] = [mb_strtolower($a), ''];
        }
        return $out;
    };
    $from = $addr($h['from'] ?? '')[0] ?? ['', ''];
    $ids = fn(string $v) => preg_match_all('/<[^>]+>/', $v, $m) ? $m[0] : [];
    $refs = $ids($h['references'] ?? ''); $irt = $ids($h['in-reply-to'] ?? ''); $mid = $ids($h['message-id'] ?? '')[0] ?? '';
    return ['h' => $h, 'from' => $from, 'to' => array_merge($addr($h['to'] ?? ''), $addr($h['cc'] ?? '')), 'subject' => pil_mime_dec_header($h['subject'] ?? ''),
        'date' => !empty($h['date']) && strtotime($h['date']) ? date('Y-m-d H:i:s', strtotime($h['date'])) : null, 'mid' => $mid, 'refs' => array_values(array_unique(array_merge($refs, $irt))),
        'root' => $refs[0] ?? ($irt[0] ?? $mid), 'text' => $res['text'] !== '' ? $res['text'] : pil_html_text($res['html']), 'atts' => $res['atts']];
}

// --------------------------------------------------------------------- Boîte hébergée : connexion, relève, pièces jointes, envoi
function pil_imap_conf(array $acc): array {
    $t = pil_mail_dec($acc['token_enc']);
    if (!$t || empty($t['pass'])) throw new PilError('Boîte ' . $acc['email'] . ' : reconnectez-la (mot de passe illisible).', 401);
    return $t;
}
function pil_imap_open(array $t): PilImap { $c = new PilImap($t['imap']['host'], (int)$t['imap']['port'], $t['imap']['sec']); $c->login($t['user'], $t['pass']); return $c; }
/** Réglages saisis : serveurs, ports et chiffrement autorisés (pas de connexion en clair, sauf sur l'instance de test). */
function pil_imap_settings(array $b, string $email): array {
    $dom = substr($email, strpos($email, '@') + 1);
    $plain = !empty(config()['mail_allow_plain']);
    $srv = function (string $k, int $defPort, array $ports) use ($b, $dom, $plain) {
        $host = mb_strtolower(trim((string)($b[$k . '_host'] ?? ''))) ?: "mail.$dom";
        if (!preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/', $host)) throw new PilError("Nom de serveur invalide : $host", 400);
        $port = (int)($b[$k . '_port'] ?? 0) ?: $defPort;
        if (!in_array($port, $ports, true) && !$plain) throw new PilError("Port $port non autorisé (" . implode(', ', $ports) . ').', 400);
        $sec = $plain && ($b['secure'] ?? '') === 'none' ? 'none' : (in_array($port, [993, 465], true) ? 'ssl' : 'tls');
        return ['host' => $host, 'port' => $port, 'sec' => $sec];
    };
    return ['imap' => $srv('imap', 993, [993, 143]), 'smtp' => $srv('smtp', 465, [465, 587])];
}
function pil_imap_connect(array $me, array $b): array {
    $email = mb_strtolower(trim((string)($b['email'] ?? ''))); $pass = (string)($b['password'] ?? '');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new PilError('Adresse e-mail invalide.', 400);
    if ($pass === '') throw new PilError('Mot de passe de la boîte manquant.', 400);
    $ex = q('SELECT id, user_id FROM pil_mail_accounts WHERE company_id = ? AND email = ?', [cid(), $email])->fetch();
    if ($ex && (int)$ex['user_id'] !== (int)$me['id']) throw new PilError("La boîte $email est déjà connectée par un autre utilisateur.", 409);
    $cfg = pil_imap_settings($b, $email);
    $t = $cfg + ['user' => trim((string)($b['user'] ?? '')) ?: $email, 'pass' => $pass];
    // vérification réelle avant d'enregistrer : réception (IMAP) et envoi (SMTP)
    $c = pil_imap_open($t); $t['sent'] = $c->sentFolder(); unset($c);
    pil_smtp_check($t['smtp'], $t['user'], $pass);
    $enc = pil_mail_enc($t);
    if ($ex) q("UPDATE pil_mail_accounts SET kind = 'imap', token_enc = ?, status = 'ok', last_error = NULL WHERE id = ?", [$enc, $ex['id']]);
    else q("INSERT INTO pil_mail_accounts (company_id, user_id, kind, email, name, token_enc, expires_at, status, created_at) VALUES (?,?,'imap',?,?,?,0,'ok',?)", [cid(), $me['id'], $email, mb_substr((string)$me['name'], 0, 190), $enc, now()]);
    $id = $ex ? (int)$ex['id'] : (int)db()->lastInsertId();
    pil_audit('boite_mail_connectee', 'mail_account', $id, null, ['email' => $email, 'type' => 'imap', 'serveur' => $t['imap']['host']]);
    return ['id' => $id, 'email' => $email, 'sent_folder' => $t['sent']];
}
function pil_imap_sync(array $acc, bool $deep): array {
    $t = pil_imap_conf($acc);
    $since = $acc['last_sync'] && !$deep ? date('Y-m-d', strtotime($acc['last_sync']) - 86400) : date('Y-m-d', time() - 14 * 86400);
    try { $c = pil_imap_open($t); } catch (PilError $e) { if ($e->getCode() === 401) q("UPDATE pil_mail_accounts SET status = 'reconnect', last_error = ? WHERE id = ?", [mb_substr($e->getMessage(), 0, 500), $acc['id']]); throw $e; }
    $new = 0;
    foreach (['INBOX' => 'in', ($t['sent'] ?? null) => 'sent'] as $folder => $kind) {
        if (!$folder) continue;
        $uv = $c->examine((string)$folder);
        $known = array_flip(q('SELECT graph_id FROM pil_mail_msgs WHERE account_id = ? AND graph_id LIKE ?', [$acc['id'], "imap:$kind:$uv:%"])->fetchAll(PDO::FETCH_COLUMN));
        $uids = array_values(array_filter($c->since($since), fn($u) => !isset($known["imap:$kind:$uv:$u"])));
        rsort($uids); $uids = array_slice($uids, 0, 150);
        foreach (array_chunk($uids, 25) as $chunk) foreach ($c->fetch($chunk, true) as $m) {
            if ($m['raw'] === null) continue;
            $p = pil_mime_parse($m['raw']);
            $isIn = $kind === 'in';
            $atts = array_values(array_map(fn($x) => ['name' => $x['name'], 'size' => $x['size'], 'type' => $x['type']], $p['atts']));
            $text = pil_mail_clean($p['text']);
            if ($isIn && pil_mail_back_in($acc, (string)$p['mid'], "imap:in:$uv:{$m['uid']}")) continue;
            $r = q('INSERT IGNORE INTO pil_mail_msgs (company_id, account_id, graph_id, conv_id, msg_ref, folder, from_email, from_name, to_json, subject, at, preview, body, atts, web_link, is_read, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [cid(), $acc['id'], "imap:$kind:$uv:{$m['uid']}", mb_substr((string)$p['root'], 0, 255), json_encode(['mid' => $p['mid'], 'refs' => array_slice($p['refs'], -10)], JSON_UNESCAPED_SLASHES), $isIn ? 'in' : 'sent',
                 $isIn ? $p['from'][0] : $acc['email'], mb_substr($isIn ? $p['from'][1] : (string)$acc['name'], 0, 190), json_encode(array_map(fn($x) => ['email' => $x[0], 'name' => $x[1]], $p['to']), JSON_UNESCAPED_UNICODE),
                 mb_substr($p['subject'], 0, 500), $p['date'] ?? $m['date'] ?? now(), mb_substr(preg_replace('/\s+/', ' ', (string)$text), 0, 400), $text,
                 $atts ? json_encode($atts, JSON_UNESCAPED_UNICODE) : null, null, str_contains($m['flags'], '\\Seen') ? 1 : 0, now()]);
            if ($r->rowCount()) $new++;
        }
    }
    unset($c);
    q("UPDATE pil_mail_msgs m JOIN (SELECT conv_id, MAX(at) AS last_sent FROM pil_mail_msgs WHERE account_id = ? AND folder = 'sent' AND conv_id <> '' GROUP BY conv_id) s ON s.conv_id = m.conv_id
        SET m.state = 'repondu' WHERE m.account_id = ? AND m.folder = 'in' AND m.state IN ('nouveau', 'a_faire') AND s.last_sent > m.at", [$acc['id'], $acc['id']]);
    q('DELETE FROM pil_mail_msgs WHERE account_id = ? AND at < ?', [$acc['id'], date('Y-m-d H:i:s', time() - PIL_MAIL_KEEP_DAYS * 86400)]);
    q("UPDATE pil_mail_accounts SET last_sync = ?, status = 'ok', last_error = NULL WHERE id = ?", [now(), $acc['id']]);
    return ['new' => $new];
}
/** PDF joints d'un e-mail (relus sur le serveur au moment de l'analyse, jamais gardés). */
function pil_imap_pdfs(array $acc, array $row, int $max): array {
    if (!preg_match('/^imap:in:(\d+):(\d+)$/', (string)$row['graph_id'], $g)) return [];
    $c = pil_imap_open(pil_imap_conf($acc));
    if ($c->examine('INBOX') !== (int)$g[1]) return [];
    $m = $c->fetch([(int)$g[2]], true)[(int)$g[2]] ?? null;
    if (!$m || $m['raw'] === null || !empty($m['partial'])) return [];
    $out = [];
    foreach (pil_mime_parse($m['raw'])['atts'] as $a) {
        if (count($out) >= $max) break;
        if ((str_contains($a['type'], 'pdf') || preg_match('/\.pdf$/i', $a['name'])) && $a['size'] <= 3 * 1024 * 1024 && str_starts_with($a['data'], '%PDF')) $out[] = ['name' => $a['name'], 'data' => $a['data']];
    }
    return $out;
}
/** Envoi depuis la boîte (SMTP de l'hébergeur), en réponse au bon e-mail, puis copie dans « Envoyés ». */
function pil_imap_send(array $acc, array $me, array $to, array $cc, string $subject, string $body, ?array $msg): ?string {
    $t = pil_imap_conf($acc);
    $from = $acc['email']; $dom = substr($from, strpos($from, '@') + 1);
    $ref = $msg ? (json_decode((string)$msg['msg_ref'], true) ?: []) : [];
    $h = ['Date: ' . date('r'), 'From: ' . mail_addr($from, (string)($acc['name'] ?: $me['name'])), 'To: ' . implode(', ', array_map(fn($a) => mail_addr($a['email'], $a['name'] ?? ''), $to))];
    if ($cc) $h[] = 'Cc: ' . implode(', ', array_map(fn($a) => mail_addr($a['email'], $a['name'] ?? ''), $cc));
    $h[] = 'Subject: ' . mail_header_enc($subject);
    $h[] = 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $dom . '>';
    if (!empty($ref['mid'])) { $h[] = 'In-Reply-To: ' . $ref['mid']; $h[] = 'References: ' . implode(' ', array_slice(array_unique(array_merge($ref['refs'] ?? [], [$ref['mid']])), -10)); }
    $h[] = 'MIME-Version: 1.0'; $h[] = 'X-Mailer: BatiPro'; $h[] = 'Content-Type: text/plain; charset=UTF-8'; $h[] = 'Content-Transfer-Encoding: base64';
    $raw = implode("\r\n", $h) . "\r\n\r\n" . chunk_split(base64_encode(str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $body)));
    smtp_send(['host' => $t['smtp']['host'], 'port' => $t['smtp']['port'], 'secure' => $t['smtp']['sec'], 'user' => $t['user'], 'pass' => $t['pass']], $from, array_merge(array_column($to, 'email'), array_column($cc, 'email')), $raw);
    // copie dans « Envoyés » (comme Outlook) : si elle échoue, l'e-mail est quand même parti
    try { if (!empty($t['sent'])) { $c = pil_imap_open($t); if (!$c->append($t['sent'], $raw)) return 'Envoyé ; copie dans « Envoyés » refusée par le serveur.'; } }
    catch (Throwable $e) { return 'Envoyé ; copie dans « Envoyés » impossible : ' . mb_substr($e->getMessage(), 0, 150); }
    return null;
}

// --------------------------------------------------------------------- Rangement (dossier « Publicité »)
/** Nom de dossier IMAP (UTF-7 modifié, RFC 3501) : « Publicité » → « Publicit&AOk- ». */
function pil_imap_utf7(string $s): string {
    return preg_replace_callback('/[^\x20-\x7e]+|&/u', function ($m) {
        if ($m[0] === '&') return '&-';
        return '&' . str_replace('/', ',', rtrim(base64_encode(mb_convert_encoding($m[0], 'UTF-16BE', 'UTF-8')), '=')) . '-';
    }, $s);
}
/** Dossier « Publicité » de la boîte (même niveau que « Envoyés » : INBOX.Publicité chez cPanel), créé si besoin. */
function pil_imap_pub_folder(PilImap $c, array $t): string {
    [$list, $delim] = $c->folders();
    $prefix = !empty($t['sent']) && preg_match('/^INBOX' . preg_quote($delim, '/') . '/i', $t['sent']) ? 'INBOX' . $delim : '';
    $name = $prefix . pil_imap_utf7(PIL_MAIL_PUB);
    if (!isset($list[$name]) && !$c->create($name)) throw new PilError('Impossible de créer le dossier « ' . PIL_MAIL_PUB . ' » sur le serveur.', 502);
    return $name;
}
function pil_imap_tidy(array $acc, array $rows): int {
    $t = pil_imap_conf($acc); $c = pil_imap_open($t); $caps = $c->caps();
    $dest = pil_imap_pub_folder($c, $t);
    $uv = $c->select('INBOX'); $n = 0;
    foreach ($rows as $r) {
        if (!preg_match('/^imap:in:(\d+):(\d+)$/', (string)$r['graph_id'], $g) || (int)$g[1] !== $uv) continue;
        $res = $c->move((int)$g[2], $dest, $caps);
        if ($res === null) break; // serveur sans déplacement sûr : on s'arrête, rien n'est supprimé
        q('UPDATE pil_mail_msgs SET graph_id = ?, moved = ? WHERE id = ?', [$res[1] ? "imap:pub:{$res[0]}:{$res[1]}" : 'imap:pub:0:0:' . $r['id'], PIL_MAIL_PUB, $r['id']]);
        $n++;
    }
    return $n;
}
/** Corbeille du serveur (dossier marqué \Trash, sinon d'après le nom ; créée au besoin). */
function pil_imap_trash_folder(PilImap $c, array $t): string {
    [$list, $delim] = $c->folders(); $byName = null;
    foreach ($list as $name => $flags) { if (preg_match('/\\Trash\b/i', $flags)) return $name;
        if (!$byName && preg_match('/(^|[.\/])(trash|deleted|deleted items|deleted messages|corbeille|supprim|papierkorb|prullenbak|verwijderd)/iu', $name)) $byName = $name; }
    if ($byName) return $byName;
    $prefix = !empty($t['sent']) && preg_match('/^INBOX' . preg_quote($delim, '/') . '/i', $t['sent']) ? 'INBOX' . $delim : '';
    if (!$c->create($prefix . 'Trash')) throw new PilError('Corbeille introuvable sur le serveur.', 502);
    return $prefix . 'Trash';
}
function pil_imap_trash(array $acc, array $row): string {
    $none = 'imap:trash:0:0:' . $row['id'];
    if (!preg_match('/^imap:(in|sent|pub):(\d+):(\d+)$/', (string)$row['graph_id'], $g) || !(int)$g[3]) return $none; // plus sur le serveur : seulement la Corbeille de BatiPro
    $t = pil_imap_conf($acc); $c = pil_imap_open($t); $caps = $c->caps();
    $folder = $g[1] === 'in' ? 'INBOX' : ($g[1] === 'sent' ? (string)($t['sent'] ?? '') : pil_imap_pub_folder($c, $t));
    if ($c->select($folder) !== (int)$g[2]) return $none;
    $res = $c->move((int)$g[3], pil_imap_trash_folder($c, $t), $caps);
    if ($res === null) throw new PilError('Le serveur n\'a pas pu mettre le message à la corbeille.', 502);
    return $res[1] ? "imap:trash:{$res[0]}:{$res[1]}" : $none;
}
function pil_imap_restore(array $acc, array $row, string $from): string {
    if (!preg_match('/^imap:trash:(\d+):(\d+)$/', (string)$row['graph_id'], $g) || !(int)$g[2]) throw new PilError('Restaurez ce message depuis la corbeille de votre messagerie.', 409);
    $t = pil_imap_conf($acc); $c = pil_imap_open($t); $caps = $c->caps();
    if ($c->select(pil_imap_trash_folder($c, $t)) !== (int)$g[1]) throw new PilError('La corbeille a changé sur le serveur : restaurez ce message depuis votre messagerie.', 409);
    $res = $c->move((int)$g[2], $from === 'sent' && !empty($t['sent']) ? (string)$t['sent'] : 'INBOX', $caps);
    if ($res === null) throw new PilError('Le serveur n\'a pas pu restaurer le message.', 502);
    return $res[1] ? "imap:$from:{$res[0]}:{$res[1]}" : "imap:$from:0:0:" . $row['id'];
}
function pil_imap_purge(array $acc, array $row): void {
    if (!preg_match('/^imap:trash:(\d+):(\d+)$/', (string)$row['graph_id'], $g) || !(int)$g[2]) return;
    $t = pil_imap_conf($acc); $c = pil_imap_open($t); $caps = $c->caps();
    if ($c->select(pil_imap_trash_folder($c, $t)) !== (int)$g[1]) return;
    $c->cmd('UID STORE ' . (int)$g[2] . ' +FLAGS.SILENT (\\Deleted)');
    if (isset($caps['UIDPLUS'])) $c->cmd('UID EXPUNGE ' . (int)$g[2]); // sans UIDPLUS : marqué supprimé, vidé par la messagerie
}
function pil_imap_unmove(array $acc, array $row): string {
    if (!preg_match('/^imap:pub:(\d+):(\d+)$/', (string)$row['graph_id'], $g) || !(int)$g[2]) throw new PilError('Déplacez ce message à la main dans Outlook (dossier « ' . PIL_MAIL_PUB . ' »).', 409);
    $t = pil_imap_conf($acc); $c = pil_imap_open($t); $caps = $c->caps();
    $c->select(pil_imap_pub_folder($c, $t));
    $res = $c->move((int)$g[2], 'INBOX', $caps);
    if ($res === null) throw new PilError('Le serveur n\'a pas pu remettre le message dans la boîte de réception.', 502);
    return $res[1] ? "imap:in:{$res[0]}:{$res[1]}" : (string)$row['graph_id'];
}
