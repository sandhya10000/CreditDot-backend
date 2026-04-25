const Blog = require('../models/Blog');
const User = require('../models/User');
const mongoose = require('mongoose');

// Helper function to generate slug
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim('-');
};

// @desc    Get all blogs
// @route   GET /api/blogs
// @access  Public
exports.getAllBlogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search, category, tag } = req.query;
    
    // Build filter
    const filter = { status: 'published' }; // Default to published blogs for public API
    if (status && status !== 'published') {
      filter.status = status;
    }
    
    // Add category filter
    if (category) {
      filter.categories = { $in: [category] };
    }
    
    // Add tag filter
    if (tag) {
      filter.tags = { $in: [tag] };
    }
    
    // Add search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { excerpt: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
        { categories: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    // Get blogs with pagination
    const blogs = await Blog.find(filter)
      .populate('author', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();
    
    // Get total count
    const total = await Blog.countDocuments(filter);
    
    res.json({
      blogs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get blog by slug
// @route   GET /api/blogs/:slug
// @access  Public
exports.getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug })
      .populate('author', 'name email');
    
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    
    // Increment views
    blog.views += 1;
    await blog.save();
    
    res.json(blog);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Create a new blog
// @route   POST /api/admin/blogs
// @access  Private/Admin
exports.createBlog = async (req, res) => {
  try {
    const { title, content, excerpt, status, tags, categories, featuredImage } = req.body;
    
    // Generate slug
    let slug = generateSlug(title);
    
    // Check if slug already exists
    let existingBlog = await Blog.findOne({ slug });
    let counter = 1;
    while (existingBlog) {
      slug = `${generateSlug(title)}-${counter}`;
      existingBlog = await Blog.findOne({ slug });
      counter++;
    }
    
    // Create blog
    const blog = new Blog({
      title,
      slug,
      content,
      excerpt,
      featuredImage,
      author: req.user.id,
      status,
      tags: tags || [],
      categories: categories || []
    });
    
    const createdBlog = await blog.save();
    
    // Populate author info
    await createdBlog.populate('author', 'name email');
    
    res.status(201).json(createdBlog);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update a blog
// @route   PUT /api/admin/blogs/:id
// @access  Private/Admin
exports.updateBlog = async (req, res) => {
  try {
    const { title, content, excerpt, status, tags, categories, featuredImage } = req.body;
    
    let blog = await Blog.findById(req.params.id);
    
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    
    // Generate new slug if title changed
    let slug = blog.slug;
    if (title && title !== blog.title) {
      slug = generateSlug(title);
      
      // Check if slug already exists (excluding current blog)
      let existingBlog = await Blog.findOne({ slug, _id: { $ne: req.params.id } });
      let counter = 1;
      while (existingBlog) {
        slug = `${generateSlug(title)}-${counter}`;
        existingBlog = await Blog.findOne({ slug, _id: { $ne: req.params.id } });
        counter++;
      }
    }
    
    // Update blog fields
    blog.title = title || blog.title;
    blog.slug = slug;
    blog.content = content || blog.content;
    blog.excerpt = excerpt || blog.excerpt;
    blog.featuredImage = featuredImage || blog.featuredImage;
    blog.status = status || blog.status;
    blog.tags = tags || blog.tags;
    blog.categories = categories || blog.categories;
    
    const updatedBlog = await blog.save();
    
    // Populate author info
    await updatedBlog.populate('author', 'name email');
    
    res.json(updatedBlog);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete a blog
// @route   DELETE /api/admin/blogs/:id
// @access  Private/Admin
exports.deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    
    await Blog.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Blog removed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get blogs for admin
// @route   GET /api/admin/blogs
// @access  Private/Admin
exports.getAdminBlogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search, category, tag } = req.query;
    
    // Build filter
    const filter = {};
    if (status) {
      filter.status = status;
    }
    
    // Add category filter
    if (category) {
      filter.categories = { $in: [category] };
    }
    
    // Add tag filter
    if (tag) {
      filter.tags = { $in: [tag] };
    }
    
    // Add search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { excerpt: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
        { categories: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    // Get blogs with pagination
    const blogs = await Blog.find(filter)
      .populate('author', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();
    
    // Get total count
    const total = await Blog.countDocuments(filter);
    
    res.json({
      blogs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all unique categories with counts
// @route   GET /api/blogs/categories
// @access  Public
exports.getBlogCategories = async (req, res) => {
  try {
    // Get all blogs with their categories
    const blogs = await Blog.find({ status: 'published' }, 'categories');
    
    // Count occurrences of each category
    const categoryCounts = {};
    blogs.forEach(blog => {
      if (blog.categories && Array.isArray(blog.categories)) {
        blog.categories.forEach(category => {
          if (category && category.trim() !== '') {
            const trimmedCategory = category.trim();
            categoryCounts[trimmedCategory] = (categoryCounts[trimmedCategory] || 0) + 1;
          }
        });
      }
    });
    
    // Convert to array format
    const categories = Object.keys(categoryCounts).map(category => ({
      name: category,
      count: categoryCounts[category]
    }));
    
    res.json({ categories });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get recent blog posts
// @route   GET /api/blogs/recent
// @access  Public
exports.getRecentBlogs = async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    
    const recentBlogs = await Blog.find({ status: 'published' })
      .populate('author', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('title createdAt featuredImage slug');
    
    res.json({ recentBlogs });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Upload blog image
// @route   POST /api/admin/blogs/upload-image
// @access  Private/Admin
exports.uploadBlogImage = async (req, res) => {
  try {
    const { uploadBlogImage } = require('../utils/fileUpload');
    
    // Use the dedicated blog image upload middleware
    const imageUpload = uploadBlogImage.single('image');
    
    imageUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: 'File upload error', error: err.message });
      }
      
      if (!req.file) {
        return res.status(400).json({ message: 'No image file uploaded' });
      }
      
      // For local development, we need to make the URL accessible
      if (process.env.NODE_ENV !== 'production') {
        // If it's a relative path, make it accessible via the server
        // Normalize the path to use forward slashes
        const normalizedPath = req.file.path.replace(/\\/g, '/');
        
        // Check if the file is in the Backend uploads directory
        if (normalizedPath.includes('Backend/uploads/')) {
          // Extract just the filename from the full path
          const fileName = req.file.path.split(/[\\/]/).pop();
          const imageUrl = `${req.protocol}://${req.get('host')}/backend-uploads/${fileName}`;
          
          return res.json({ 
            imageUrl: imageUrl,
            fileName: fileName,
            originalName: req.file.originalname
          });
        }
        
        // Also check for root uploads directory (backward compatibility)
        if (normalizedPath.includes('uploads/')) {
          // Extract just the filename from the full path
          const fileName = req.file.path.split(/[\\/]/).pop();
          const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
          
          return res.json({ 
            imageUrl: imageUrl,
            fileName: fileName,
            originalName: req.file.originalname
          });
        }
      }
      
      // For production, normalize the path and return the correct URL
      // Extract just the filename from the full path
      const fileName = req.file.path.split(/[\\/]/).pop();
      // Check if file is in Backend/uploads, otherwise use root uploads
      const isBackendUpload = req.file.path.includes('Backend') || req.file.path.includes('backend');
      const baseUrl = isBackendUpload ? '/backend-uploads/' : '/uploads/';
      const imageUrl = `${req.protocol}://${req.get('host')}${baseUrl}${fileName}`;
      
      res.json({ 
        imageUrl: imageUrl,
        fileName: fileName,
        originalName: req.file.originalname
      });
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all unique tags
// @route   GET /api/blogs/tags
// @access  Public
exports.getBlogTags = async (req, res) => {
  try {
    // Get all blogs with their tags
    const blogs = await Blog.find({ status: 'published' }, 'tags');
    
    // Count occurrences of each tag
    const tagCounts = {};
    blogs.forEach(blog => {
      if (blog.tags && Array.isArray(blog.tags)) {
        blog.tags.forEach(tag => {
          if (tag && tag.trim() !== '') {
            const trimmedTag = tag.trim();
            tagCounts[trimmedTag] = (tagCounts[trimmedTag] || 0) + 1;
          }
        });
      }
    });
    
    // Convert to array format
    const tags = Object.keys(tagCounts).map(tag => ({
      name: tag,
      count: tagCounts[tag]
    }));
    
    res.json({ tags });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
