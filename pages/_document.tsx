import Document, { Head, Html, Main, NextScript } from "next/document";

class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <link rel="icon" href="/favicon.ico" />
          <meta
            name="description"
            content="Give a song and a topic, get a song about that topic"
          />
          <meta property="og:site_name" content="poet.poiesis.education" />
          <meta
            property="og:description"
            content="Give a song and a topic, get a song about that topic"
          />
          <meta property="og:title" content="Twitter Bio Generator" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="Twitter Bio Generator" />
          <meta
            name="twitter:description"
            content="Give a song and a topic, get a song about that topic"
          />
          <meta
            property="og:image"
            content="https://poet.poiesis.education/og-image.png"
          />
          <meta
            name="twitter:image"
            content="https://poet.poiesis.education/og-image.png"
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
