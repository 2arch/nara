// app/page.tsx
import FullScreenAnimation from './landing/full';
import Half from './landing/half';
import Carousel from './landing/carousel';

export default function Home() {
  const carouselItems1 = [
    { id: 1, content: <p>Item 1</p> },
    { id: 2, content: <p>Item 2</p> },
    { id: 3, content: <p>Item 3 with Learn More</p> },
  ];

  const finalCarouselItems = [
    { id: 1, content: <p>Feature One</p> },
    { id: 2, content: <p>Feature Two</p> },
    { id: 3, content: <p>Final Feature</p> },
  ];

  return (
    <main className="bg-black">
      {/* Title / Full Screen Animation */}
      <section>
        <FullScreenAnimation blurb="A descriptive blurb for the animation." />
      </section>

      {/* Title / Subtitle / Half + Carousel */}
      <section className="my-8">
        <h1 className="text-3xl font-bold p-4 text-white">Features</h1>
        <h2 className="text-2xl font-semibold px-4 pb-2 text-gray-300">truly infinite</h2>
        <Half>
            <p>Content for the right side of the Half component.</p>
        </Half>
      </section>
      
      {/* Another Carousel Section */}
      <section className="my-8">
         <h2 className="text-2xl font-semibold px-4 pb-2 text-gray-300">gestures</h2>
        <Carousel items={carouselItems1} />
      </section>

      {/* Another Carousel Section */}
      <section className="my-8">
         <h2 className="text-2xl font-semibold px-4 pb-2 text-gray-300">co-pilot</h2>
        <Carousel items={carouselItems1} />
      </section>

      {/* Title / Carousel */}
      <section className="my-8">
        <h1 className="text-3xl font-bold p-4 text-white">More Features</h1>
        <Carousel items={finalCarouselItems} />
      </section>
    </main>
  );
}