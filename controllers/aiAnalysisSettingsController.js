const Setting = require('../models/Setting');

// Get AI analysis prompt settings
const getAIAnalysisSettings = async (req, res) => {
  try {
    const promptSetting = await Setting.findOne({ key: 'ai_analysis_prompt' });
    const modelSetting = await Setting.findOne({ key: 'claude_model' });

    res.json({
      prompt: promptSetting ? promptSetting.value : process.env.AI_ANALYSIS_PROMPT,
      model: modelSetting ? modelSetting.value : process.env.CLAUDE_MODEL,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update AI analysis prompt
const updateAIAnalysisPrompt = async (req, res) => {
  try {
    const { prompt, model } = req.body;

    if (!prompt && !model) {
      return res.status(400).json({ message: 'Either prompt or model must be provided' });
    }

    // Update prompt if provided
    if (prompt) {
      await Setting.findOneAndUpdate(
        { key: 'ai_analysis_prompt' },
        { 
          key: 'ai_analysis_prompt',
          value: prompt,
          description: 'Custom prompt for Claude AI document analysis'
        },
        { upsert: true, new: true }
      );
    }

    // Update model if provided
    if (model) {
      await Setting.findOneAndUpdate(
        { key: 'claude_model' },
        {
          key: 'claude_model',
          value: model,
          description: 'Claude AI model to use for analysis'
        },
        { upsert: true, new: true }
      );
    }

    res.json({
      message: 'AI analysis settings updated successfully',
      prompt: prompt || process.env.AI_ANALYSIS_PROMPT,
      model: model || process.env.CLAUDE_MODEL
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getAIAnalysisSettings,
  updateAIAnalysisPrompt
};
