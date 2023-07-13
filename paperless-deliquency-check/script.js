(async () => {
  // yes it's terrible, please contribute or fuck off

  const url = "https://paperless.hackerspace.pl";
  if (!location.href.startsWith(url)) {
    alert("Go to paperless you dum dum");
    location.href = url;
    return;
  }

  // // Switch to table view
  // try {
  //   document
  //     .querySelectorAll("div[role=radiogroup]:has(label+label+label)")[0]
  //     .children[0].click();
  // } catch (_e) {
  //   alert("Switch to table view and try again! -- switch in top-right");
  //   return;
  // }

  // // Get invoice names
  // const rawTitles = Array.from(
  //   document.querySelectorAll("table tr td:nth-of-type(4) > a")
  // ).map((a) => a.innerText);
  // console.log(rawTitles);

  // if (!rawTitles.every((rawTitle) => rawTitle.match(/^FV\d{4,}$/))) {
  //   alert("Unexpected invoice names - expected all to match FVxxxxx");
  //   return;
  // }

  const csrfToken = document.cookie
    .split(";")
    .map((cookie) => cookie.trim().split("="))
    .find(([name]) => name === "csrftoken")[1]
    .trim();

  if (!csrfToken.length) {
    alert("No csrf token found :(");
    return;
  }

  console.log("fetching tags...");
  const rawTags = await (
    await fetch(`/api/tags/?format=json`, {
      headers: { Accept: "application/json; version=2" },
    })
  ).json();
  console.log({ rawTags });

  console.log("fetching correspondents...");
  const rawCorrespondents = await (
    await fetch(`/api/correspondents/?format=json`, {
      headers: { Accept: "application/json; version=2" },
    })
  ).json();
  console.log({ rawCorrespondents });

  console.log("fetching own invoices...");
  const rawInvoices = [];

  // TODO: really, limit of 25? no way to set it higher via url?
  let rawInvoicesUrl = `/api/documents/?format=json&document_type__id=1`;
  while (true) {
    console.log(`fetching chunk from ${rawInvoicesUrl}`);
    const rawInvoicesChunk = await (
      await fetch(rawInvoicesUrl, {
        headers: { Accept: "application/json; version=2" },
      })
    ).json();
    rawInvoices.push(...rawInvoicesChunk.results);
    if (!rawInvoicesChunk.next) {
      break;
    }
    rawInvoicesUrl = rawInvoicesChunk.next;
  }

  console.log({ rawInvoices });

  const sentTag = rawTags.results.find((tag) => tag.slug === "sent");
  const paymentReceivedTag = rawTags.results.find(
    (tag) => tag.slug === "payment-received"
  );
  const paymentDeliquencyTag = rawTags.results.find(
    (tag) => tag.slug === "payment-deliquency"
  );

  if (!(sentTag && paymentReceivedTag && paymentDeliquencyTag)) {
    throw new Error("Could not find tags...");
  }

  const invoices = rawInvoices
    .map((invoice) => {
      // invoice not yet sent
      if (!invoice.tags.includes(sentTag.id)) {
        return null;
      }

      // invoice already paid for
      if (invoice.tags.includes(paymentReceivedTag.id)) {
        return null;
      }

      const {
        id,
        title,
        created: createdAt,
        added: addedAt,
        correspondent: correspondentId,
        tags,
        content,
      } = invoice;

      const titleMatch = title.match(/^FV(\d{4,})$/);
      if (!titleMatch) {
        throw new Error(
          `Unexpected invoice title: ${title}. Expected to match FVxxxxx`
        );
      }
      const [, invoiceNumberStr] = titleMatch;
      const invoiceNumber = parseInt(invoiceNumberStr, 10);

      const correspondent = rawCorrespondents.results.find(
        ({ id }) => id === correspondentId
      );
      if (!correspondent) {
        throw new Error(
          `Could not find correspondent with id: ${correspondentId}`
        );
      }

      // based on OCR data, so possibly unreliable
      const priceHintMatch = content.match(
        /RAZEM\s+BRUTTO\s+PLN\s*(\d+\.\d{2})/i
      );

      return {
        id,
        createdAt,
        addedAt,
        title,
        invoiceNumber,
        correspondentName: correspondent.name,
        correspondentAlt: correspondent.match,
        priceHint: priceHintMatch ? parseFloat(priceHintMatch[1]) : null,
        isSent: tags.includes(sentTag.id),
        isPaymentReceived: tags.includes(paymentReceivedTag.id),
        isPaymentDeliquency: tags.includes(paymentDeliquencyTag.id),
        tagIds: tags,
      };
    })
    .filter(Boolean);

  console.table(invoices);

  // Prepare cheapo sql
  const yoloescape = (v) => v.replaceAll(/[^a-z0-9 _-]/gi, " ").trim(); // xDDDDDDDD
  const preparedSqlInvoices = invoices.map(
    ({ id, invoiceNumber, correspondentName, correspondentAlt, priceHint }) => {
      return `(${id}, 'FV${invoiceNumber}', 'FV\s*[\/-]?\s*${invoiceNumber}', '${yoloescape(
        correspondentName
      )}', '${yoloescape(correspondentAlt)}', ${priceHint || "null"})`;
    }
  );
  const sql = `with invoices(paperless_id, invoice_id, invoice_regex, invoice_correspondent, invoice_correspondent_alt, invoice_price_hint) as (values${preparedSqlInvoices}) select paperless_id,invoice_id,invoice_correspondent,invoice_correspondent_alt,invoice_price_hint,date,title,from_name,from_account, round(amount/100::numeric, 2) as amt, currency from invoices left join raw_transfer on title ~* invoice_regex where (type = 'IN' or type is null) order by invoice_id desc`;
  // const sqlWithCopy = `\\copy (${sql}) to 'deliquency_report.txt' delimiter '~' csv header;`;
  const sqlJsonWithCopy = `\\copy (with sq as (${sql}) select json_agg(row_to_json(sq)) from sq) to 'deliquency_report.json';`;
  // navigator.clipboard.writeText(sql)
  // console.log(sql);
  console.log(sqlJsonWithCopy);

  alert(
    "SQL generated - check console, run in psql, then copy contents of deliquency_report.json and paste it into next prompt"
  );

  // get report
  const reportStr = prompt("Paste deliquency_report.json here");
  const report = JSON.parse(reportStr);
  console.log("Deliquency report:");
  console.table(report);

  const processedIds = new Set();
  const goodInvoices = [];
  const suspiciousInvoices = [];
  report.forEach((row) => {
    if (processedIds.has(row.paperless_id)) {
      throw new Error(`Duplicate paperless_id: ${row.paperless_id}`);
    }

    const invoice = invoices.find((invoice) => invoice.id === row.paperless_id);
    if (!invoice) {
      throw new Error(`Could not find invoice with id: ${row.paperless_id}`);
    }

    // row.url = `https://paperless.hackerspace.pl/documents/${row.paperless_id}`;

    const hasMatchingPayment = !!row.title;
    if (hasMatchingPayment) {
      if (
        row.invoice_price_hint &&
        Math.abs(row.invoice_price_hint - row.amt) > 0.01
      ) {
        console.warn(
          `⚠️ Invoice ${row.invoice_id} paid for but the amount seems wrong? Expected: ${row.invoice_price_hint}, actual: ${row.amt}`
        );
        suspiciousInvoices.push(row);
      } else {
        goodInvoices.push(row);
      }
    } else {
      suspiciousInvoices.push(row);
    }

    processedIds.add(row.paperless_id);
  });

  // report on results
  console.log("Good invoices:");
  console.table(goodInvoices);

  console.log(
    "Suspicious invoices (no payment found or paid but wrong amount):"
  );
  console.table(suspiciousInvoices);

  console.log("Groupped by correspondent:");
  const suspiciousInvoicesByCorrespondent = {};
  suspiciousInvoices.forEach((row) => {
    const { invoice_correspondent } = row;
    if (!suspiciousInvoicesByCorrespondent[invoice_correspondent]) {
      suspiciousInvoicesByCorrespondent[invoice_correspondent] = [];
    }
    suspiciousInvoicesByCorrespondent[invoice_correspondent].push(row);
  });

  Object.entries(suspiciousInvoicesByCorrespondent).forEach(
    ([correspondent, rows]) => {
      console.log(
        `%cSuspicious invoices for ${correspondent}:`,
        `font-size: 28px; font-weight: bold;`
      );
      // get correspondent
      const firstRawInvoice = rawInvoices.find(
        (invoice) => invoice.id === rows[0].paperless_id
      );
      if (!firstRawInvoice) {
        throw new Error(
          `Could not find raw invoice with id: ${rows[0].paperless_id}`
        );
      }
      const correspondentInfo = rawCorrespondents.results.find(
        ({ id }) => id === firstRawInvoice.correspondent
      );

      console.log(
        `View correspondent: https://paperless.hackerspace.pl/documents?correspondent__id=${correspondentInfo.id}`
      );
      console.log(`Name: ${correspondentInfo.name}`);
      console.log(`Alt name: ${correspondentInfo.match}`);

      console.log("Use these queries in psql to look for all payments:");

      const getCorrespondentSql = (name) =>
        `select date,title,from_name,from_account, round(amount/100::numeric, 2) as amt, currency from raw_transfer where from_name ~* '${yoloescape(
          name
        )}' order by date desc limit 50;`;
      console.log(getCorrespondentSql(correspondentInfo.name));
      console.log(getCorrespondentSql(correspondentInfo.match));

      console.log("Missing invoices:");
      console.table(
        rows.map(({ paperless_id }) => {
          const invoice = invoices.find(
            (invoice) => invoice.id === paperless_id
          );
          const {
            id,
            createdAt,
            addedAt,
            title,
            invoiceNumber,
            priceHint,
            isPaymentDeliquency,
          } = invoice;
          return {
            id,
            createdAt,
            addedAt,
            title,
            invoiceNumber,
            priceHint,
            isPaymentDeliquency,
          };
        })
      );
    }
  );

  // set good invoices as paid
  console.log("Marking good invoices as paid...");
  for (row of goodInvoices) {
    const invoice = invoices.find((invoice) => invoice.id === row.paperless_id);
    const { id, tagIds } = invoice;

    const res = await fetch(`/api/documents/${id}/`, {
      method: "PATCH",
      headers: {
        Accept: "application/json; version=2",
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
      },
      body: JSON.stringify({
        id,
        tags: tagIds
          .filter(
            (tagId) =>
              tagId !== paymentDeliquencyTag.id && tagId !== paymentReceivedTag
          )
          .concat(paymentReceivedTag.id),
      }),
    });

    if (!res.ok) {
      console.error(`Failed to set invoice ${row.invoice_id} (${id}) as paid`);
    } else {
      console.log(`Invoice ${row.invoice_id} (${id}) marked as paid`);
    }
  }

  console.log("✅ All done");
})();
