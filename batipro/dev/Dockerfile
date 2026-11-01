# Environnement de TEST BatiPro – proche d'un hébergement cPanel (Apache + PHP 8.1 + MariaDB).
# Jamais utilisé en production.
FROM php:8.1-apache
RUN docker-php-ext-install pdo_mysql \
 && a2enmod rewrite headers \
 && sed -i 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf \
 && echo "date.timezone=Europe/Brussels" > /usr/local/etc/php/conf.d/tz.ini
