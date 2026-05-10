(function () {
      // Nav scroll effect
      var navbar = document.getElementById('navbar');
      window.addEventListener('scroll', function () {
        navbar.classList.toggle('scrolled', window.scrollY > 20);
      }, { passive: true });

      // Mobile nav toggle
      var toggle = document.getElementById('navToggle');
      var links  = document.getElementById('navLinks');
      toggle.addEventListener('click', function () {
        links.classList.toggle('open');
      });
      links.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () { links.classList.remove('open'); });
      });

      // Scroll-triggered fade-up
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -36px 0px' });

      document.querySelectorAll('.fade-up').forEach(function (el) {
        observer.observe(el);
      });
    }());