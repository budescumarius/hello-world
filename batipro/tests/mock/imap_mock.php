<?php
// Faux serveur de messagerie (IMAP sur 9143 + SMTP sur 9025, sans chiffrement) pour les tests : données 100 % fictives.
// Lancé dans le conteneur de test : php imap_mock.php ; boîte : direction@madibu-fictif.be / mot de passe « Boite-Test-1 ».
// Journal : /tmp/imap_mock.log (connexions, APPEND) et /tmp/smtp_mock.log (e-mails « envoyés »).
$USER = 'direction@madibu-fictif.be'; $PASS = 'Boite-Test-1';
$log = fn($f, $v) => file_put_contents(sys_get_temp_dir() . "/$f", json_encode($v, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
$d = fn($h) => date('r', time() - $h * 3600);
$pdf = chunk_split(base64_encode("%PDF-1.4\n% devis fictif 1.250,00\n%%EOF"));
$INBOX = [
 11 => "From: =?iso-8859-1?Q?Fran=E7ois_Client?= <client@exemple-fictif.be>\r\nTo: direction@madibu-fictif.be\r\nSubject: =?UTF-8?B?RGVtYW5kZSBkZSBkZXZpcyBjdWlzaW5lIER1cG9udA==?=\r\nDate: {$d(5)}\r\nMessage-ID: <q1@exemple-fictif.be>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"B1\"\r\n\r\n--B1\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nBonjour,\r\nPouvez-vous nous envoyer le devis pour la cuisine avant vendredi ? Acompte pr=E9vu de 1.250,00 =80.\r\nVirement depuis BE68 5390 0754 7034.\r\n\r\nLe lun. 2 nov. 2026, MADIBU a =E9crit :\r\n> Ancien message cit=E9\r\n--B1\r\nContent-Type: application/pdf; name=\"devis-fictif.pdf\"\r\nContent-Disposition: attachment; filename=\"devis-fictif.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\n$pdf--B1--\r\n",
 12 => "From: Promo Fictive <promo@pub-fictif.be>\r\nTo: direction@madibu-fictif.be\r\nSubject: Soldes -30 % sur l'outillage\r\nDate: {$d(30)}\r\nMessage-ID: <p1@pub-fictif.be>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><p>Profitez de nos promotions.</p></body></html>\r\n",
 13 => "From: Architecte Fictif <archi@bureau-fictif.be>\r\nTo: direction@madibu-fictif.be\r\nSubject: Plans modifiés\r\nDate: {$d(72)}\r\nMessage-ID: <a1@bureau-fictif.be>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nVoici les plans modifiés.\r\n",
];
$SENT = [21 => "From: direction@madibu-fictif.be\r\nTo: archi@bureau-fictif.be\r\nSubject: RE: Plans modifiés\r\nDate: {$d(48)}\r\nMessage-ID: <r1@madibu-fictif.be>\r\nIn-Reply-To: <a1@bureau-fictif.be>\r\nReferences: <a1@bureau-fictif.be>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMerci.\r\n"];
$imap = stream_socket_server('tcp://127.0.0.1:9143'); $smtp = stream_socket_server('tcp://127.0.0.1:9025');
while (true) {
    $r = [$imap, $smtp]; $w = $e = null;
    if (!stream_select($r, $w, $e, null)) continue;
    foreach ($r as $srv) {
        $c = stream_socket_accept($srv); if (!$c) continue; stream_set_timeout($c, 10);
        $put = function ($s) use ($c) { fwrite($c, $s . "\r\n"); };
        if ($srv === $smtp) {
            $put('220 fictif ESMTP'); $auth = 0; $data = null; $rcpt = [];
            while (($l = fgets($c)) !== false) {
                $l = rtrim($l, "\r\n");
                if ($data !== null) { if ($l === '.') { $log('smtp_mock.log', ['rcpt' => $rcpt, 'data' => $data]); $data = null; $put('250 OK queued'); } else $data .= $l . "\n"; continue; }
                if ($auth === 1) { $u = base64_decode($l); $auth = $u === $USER ? 2 : -1; $put('334 UGFzc3dvcmQ6'); continue; }
                if ($auth === 2 || $auth === -1) { $ok = $auth === 2 && base64_decode($l) === $PASS; $auth = $ok ? 3 : 0; $put($ok ? '235 OK' : '535 refusé'); continue; }
                $cmd = strtoupper(substr($l, 0, 4));
                if ($cmd === 'EHLO') $put("250-fictif\r\n250 AUTH LOGIN");
                elseif ($l === 'AUTH LOGIN') { $auth = 1; $put('334 VXNlcm5hbWU6'); }
                elseif ($cmd === 'MAIL') $put($auth === 3 ? '250 OK' : '530 auth');
                elseif ($cmd === 'RCPT') { $rcpt[] = trim(substr($l, 8), '<>'); $put('250 OK'); }
                elseif ($cmd === 'DATA') { $data = ''; $put('354 go'); }
                elseif ($cmd === 'QUIT') { $put('221 bye'); break; }
                else $put('250 OK');
            }
            fclose($c); continue;
        }
        $put('* OK IMAP fictif'); $sel = null; $authed = false;
        while (($l = fgets($c)) !== false) {
            $l = rtrim($l, "\r\n"); [$tag, $rest] = array_pad(explode(' ', $l, 2), 2, ''); $U = strtoupper($rest);
            if (str_starts_with($U, 'LOGIN ')) { preg_match_all('/"((?:[^"\\\\]|\\\\.)*)"/', $rest, $m); $ok = stripcslashes($m[1][0] ?? '') === $USER && stripcslashes($m[1][1] ?? '') === $PASS; $authed = $ok; $log('imap_mock.log', ['login' => $ok]); $put($ok ? "$tag OK" : "$tag NO [AUTHENTICATIONFAILED] refusé"); continue; }
            if (!$authed && !str_starts_with($U, 'LOGOUT')) { $put("$tag NO login"); continue; }
            if (str_starts_with($U, 'LIST')) { $put('* LIST (\\HasNoChildren) "." "INBOX"'); $put('* LIST (\\HasNoChildren \\Sent) "." "INBOX.Sent"'); $put("$tag OK"); }
            elseif (str_starts_with($U, 'EXAMINE') || str_starts_with($U, 'SELECT')) { $sel = str_contains($rest, 'Sent') ? 'sent' : 'in'; $put('* OK [UIDVALIDITY 777] ok'); $put("$tag OK"); }
            elseif (str_starts_with($U, 'UID SEARCH')) { $put('* SEARCH ' . implode(' ', array_keys($sel === 'sent' ? $SENT : $INBOX))); $put("$tag OK"); }
            elseif (str_starts_with($U, 'UID FETCH')) {
                preg_match('/UID FETCH ([\d,]+) \((.*)\)$/i', $rest, $m); $box = $sel === 'sent' ? $SENT : $INBOX;
                foreach (explode(',', $m[1]) as $i => $uid) { $msg = $box[(int)$uid] ?? null; if (!$msg) continue;
                    if (stripos($m[2], 'BODY.PEEK[]') !== false) { fwrite($c, "* " . ($i + 1) . " FETCH (UID $uid BODY[] {" . strlen($msg) . "}\r\n" . $msg . ")\r\n"); }
                    elseif (stripos($m[2], 'BODY.PEEK[HEADER]') !== false) { $h = substr($msg, 0, strpos($msg, "\r\n\r\n") + 4); fwrite($c, "* " . ($i + 1) . " FETCH (UID $uid BODY[HEADER] {" . strlen($h) . "}\r\n" . $h . ")\r\n"); }
                    else $put("* " . ($i + 1) . " FETCH (UID $uid FLAGS () INTERNALDATE \"" . date('d-M-Y H:i:s O') . "\" RFC822.SIZE " . strlen($msg) . ")"); }
                $put("$tag OK");
            }
            elseif (str_starts_with($U, 'APPEND')) { preg_match('/\{(\d+)\}$/', $rest, $m); $put('+ go'); $data = ''; while (strlen($data) < (int)$m[1]) $data .= fread($c, (int)$m[1] - strlen($data)); fgets($c); $log('imap_mock.log', ['append' => str_contains($rest, 'INBOX.Sent'), 'data' => $data]); $put("$tag OK"); }
            elseif (str_starts_with($U, 'LOGOUT')) { $put('* BYE'); $put("$tag OK"); break; }
            else $put("$tag OK");
        }
        fclose($c);
    }
}
