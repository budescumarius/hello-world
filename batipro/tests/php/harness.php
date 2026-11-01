<?php
// Mini-harnais de test sans dépendance (pas de PHPUnit à installer sur l'hébergement).
// Les tests parlent à une instance BatiPro de TEST (Apache + PHP 8.1 + MariaDB, données fictives).
declare(strict_types=1);

final class T {
    public static int $pass = 0;
    public static array $fail = [];
    public static string $base = 'http://127.0.0.1:8081';

    public static function test(string $name, callable $fn): void {
        try { $fn(); self::$pass++; echo "  ✔ $name\n"; }
        catch (Throwable $e) { self::$fail[] = $name; echo "  ✘ $name\n      → " . $e->getMessage() . "\n"; }
    }
    public static function eq($expected, $actual, string $msg = ''): void {
        if ($expected !== $actual) throw new RuntimeException(($msg ? "$msg : " : '') . 'attendu ' . json_encode($expected, JSON_UNESCAPED_UNICODE) . ', obtenu ' . json_encode($actual, JSON_UNESCAPED_UNICODE));
    }
    public static function ok($cond, string $msg): void { if (!$cond) throw new RuntimeException($msg); }
    public static function done(): int {
        echo "\n" . self::$pass . ' réussi(s), ' . count(self::$fail) . " échec(s)\n";
        return self::$fail ? 1 : 0;
    }
}

/** Client HTTP avec sa propre session (un par utilisateur simulé). */
final class Client {
    private string $jar;
    public function __construct(public string $label = '') { $this->jar = tempnam(sys_get_temp_dir(), 'bpjar'); }
    public function __destruct() { @unlink($this->jar); }

    /** @return array{0:int,1:mixed,2:string} code, JSON décodé, corps brut */
    public function req(string $method, string $route, $body = null, array $opt = []): array {
        $url = T::$base . '/' . ($opt['raw'] ?? ('api.php?r=' . $route));
        $h = curl_init($url);
        $headers = [];
        if (empty($opt['noCsrf'])) $headers[] = 'X-Requested-With: batipro';
        curl_setopt_array($h, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $this->jar,
            CURLOPT_COOKIEFILE => $this->jar, CURLOPT_TIMEOUT => 30, CURLOPT_FOLLOWLOCATION => false]);
        if (isset($opt['multipart'])) curl_setopt($h, CURLOPT_POSTFIELDS, $opt['multipart']);
        elseif (isset($opt['form'])) curl_setopt($h, CURLOPT_POSTFIELDS, http_build_query($opt['form']));
        elseif ($body !== null) { curl_setopt($h, CURLOPT_POSTFIELDS, json_encode($body)); $headers[] = 'Content-Type: application/json'; }
        curl_setopt($h, CURLOPT_HTTPHEADER, $headers);
        $raw = (string)curl_exec($h);
        $code = (int)curl_getinfo($h, CURLINFO_RESPONSE_CODE);
        curl_close($h);
        return [$code, json_decode($raw, true), $raw];
    }
    public function login(string $email, string $pass): array { return $this->req('POST', 'auth/login', ['email' => $email, 'password' => $pass]); }
}

function db(): PDO {
    static $pdo = null;
    return $pdo ??= new PDO('mysql:host=127.0.0.1;port=3307;dbname=batipro_test;charset=utf8mb4', 'batipro', 'batipro-test',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
}
