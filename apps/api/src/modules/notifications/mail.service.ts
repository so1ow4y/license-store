import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { ENV, type Env } from '@common/config/env.schema';

/**
 * Транспорт электронной почты.
 *
 * Локально письма ловит Mailpit — они никуда не уходят, но видны
 * в http://localhost:8025. Это принципиально: письма подтверждения
 * и сброса пароля надо уметь проверять глазами, ничего не отправляя
 * реальным адресатам.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(ENV) env: Env) {
    this.from = env.SMTP_FROM;

    // Подпись DKIM включается, только когда заданы ВСЕ три поля. Частично
    // заполненная настройка — это не «полработы», а сломанная подпись:
    // получатель увидит заголовок DKIM, не сможет его проверить и отправит
    // письмо в спам увереннее, чем если бы подписи не было вовсе.
    const dkim =
      env.DKIM_DOMAIN && env.DKIM_SELECTOR && env.DKIM_PRIVATE_KEY
        ? {
            domainName: env.DKIM_DOMAIN,
            keySelector: env.DKIM_SELECTOR,
            // В .env многострочного значения не бывает, поэтому ключ хранится
            // с \n вместо переводов строк и разворачивается здесь. PEM без
            // настоящих переводов строк не разбирается.
            privateKey: env.DKIM_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }
        : undefined;

    if (dkim) {
      this.logger.log(`DKIM включён: ${dkim.keySelector}._domainkey.${dkim.domainName}`);
    } else {
      // Не warn: без подписи система работает, просто письма чаще попадают
      // в спам. Ругаться на штатную настройку разработки незачем.
      this.logger.log('DKIM выключен — письма уходят без подписи');
    }

    // Свой ли это релей в сети compose.
    //
    // Признак — отсутствие точки в имени: `postfix`, `mailpit` разрешаются
    // только внутренним DNS докера, а у любого внешнего провайдера имя вида
    // `smtp.provider.com` точку содержит обязательно.
    //
    // ЗАЧЕМ РАЗЛИЧАТЬ. Свой postfix предъявляет самоподписанный сертификат, и
    // nodemailer рвёт соединение: «self-signed certificate». Проверять этот
    // сертификат нечем и незачем — трафик не покидает хост, а подменить
    // соседний контейнер может только тот, кто уже внутри. Но выключать
    // проверку ВСЕГДА нельзя: для внешнего провайдера это открытая дверь для
    // посредника, который подменит сервер и прочитает письма с их ссылками
    // на сброс пароля.
    const internalRelay = !env.SMTP_HOST.includes('.');

    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      dkim,
      ...(internalRelay ? { tls: { rejectUnauthorized: false } } : {}),
      // Пул соединений: рассылка идёт пачками, и открывать SMTP-сессию
      // на каждое письмо — лишние сотни миллисекунд на штуку.
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.transport.verify();
      // ЧТО ЭТА СТРОКА ЗНАЧИТ, А ЧТО НЕТ. verify() открывает соединение и
      // делает EHLO — и всё. Она НЕ доказывает, что письмо уйдёт: при
      // smtpd_delay_reject = yes (умолчание) ограничения по клиенту и по
      // отправителю вычисляются только на RCPT TO, а милтер DKIM вызывается
      // на DATA. Прежний текст «SMTP-соединение проверено» печатался
      // одинаково и когда подсеть API попала в mynetworks, и когда не
      // попала, и когда opendkim не подписывает.
      //
      // Признак «отправка жива» после выкладки — scripts/mail-check.sh и
      // живое письмо, а не эта строка.
      this.logger.log('SMTP отвечает на EHLO — это ещё не проверка отправки');
    } catch (error) {
      // Не бросаем: недоступный SMTP не должен мешать API отвечать.
      // Письма осядут в очереди со статусом PENDING и уйдут, когда
      // почта поднимется.
      this.logger.warn(
        `SMTP недоступен на старте: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Отправка. Бросает при неудаче — вызывающий отметит попытку
   * и повторит позже.
   */
  async send(params: { to: string; subject: string; text: string }): Promise<string> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });

    return String(info.messageId ?? '');
  }
}
